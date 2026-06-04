use anyhow::Result;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use crate::db::{with_db, with_db_mut};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TemplateFile {
    pub id: i32,
    pub template_id: i32,
    pub filename: String,
    pub content: String,
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Template {
    pub id: i32,
    pub name: String,
    pub description: String,
    pub is_public: bool,
    pub files: Vec<TemplateFile>,
    pub created_at: String,
}

fn fetch_inner(conn: &Connection, id: i32) -> Result<Template> {
    let mut t = conn.query_row(
        "SELECT id, name, description, is_public, created_at FROM templates WHERE id = ?1",
        params![id],
        |row| {
            Ok(Template {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                is_public: row.get::<_, i32>(3)? != 0,
                files: vec![],
                created_at: row.get(4)?,
            })
        },
    )?;
    t.files = conn
        .prepare(
            "SELECT id, template_id, filename, content, sort_order
             FROM template_files WHERE template_id = ?1 ORDER BY sort_order, id",
        )?
        .query_map(params![id], |row| {
            Ok(TemplateFile {
                id: row.get(0)?,
                template_id: row.get(1)?,
                filename: row.get(2)?,
                content: row.get(3)?,
                sort_order: row.get(4)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?;
    Ok(t)
}

pub fn list_templates() -> Result<Vec<Template>> {
    with_db(|conn| {
        let ids: Vec<i32> = conn
            .prepare("SELECT id FROM templates ORDER BY created_at DESC")?
            .query_map([], |r| r.get(0))?
            .collect::<std::result::Result<_, _>>()?;
        ids.into_iter().map(|id| fetch_inner(conn, id)).collect()
    })
}

pub fn create_template(
    name: &str,
    description: &str,
    is_public: bool,
    files: &[(String, String)],
) -> Result<Template> {
    with_db_mut(|conn| {
        let template_id: i32;
        {
            let tx = conn.transaction()?;
            tx.execute(
                "INSERT INTO templates(name, description, is_public, created_at)
                 VALUES(?1,?2,?3,datetime('now'))",
                params![name, description, is_public as i32],
            )?;
            let id = tx.last_insert_rowid() as i32;
            template_id = id;
            for (i, (filename, content)) in files.iter().enumerate() {
                tx.execute(
                    "INSERT INTO template_files(template_id, filename, content, sort_order)
                     VALUES(?1,?2,?3,?4)",
                    params![id, filename, content, i as i32],
                )?;
            }
            tx.commit()?;
        }
        fetch_inner(conn, template_id)
    })
}

pub fn update_template(
    id: i32,
    name: &str,
    description: &str,
    is_public: bool,
    files: &[(String, String)],
) -> Result<Template> {
    with_db_mut(|conn| {
        {
            let tx = conn.transaction()?;
            tx.execute(
                "UPDATE templates SET name=?1, description=?2, is_public=?3 WHERE id=?4",
                params![name, description, is_public as i32, id],
            )?;
            tx.execute(
                "DELETE FROM template_files WHERE template_id = ?1",
                params![id],
            )?;
            for (i, (filename, content)) in files.iter().enumerate() {
                tx.execute(
                    "INSERT INTO template_files(template_id, filename, content, sort_order)
                     VALUES(?1,?2,?3,?4)",
                    params![id, filename, content, i as i32],
                )?;
            }
            tx.commit()?;
        }
        fetch_inner(conn, id)
    })
}

pub fn delete_template(id: i32) -> Result<()> {
    with_db(|conn| {
        conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
        Ok(())
    })
}

pub fn save_gist_as_template(gist_id: &str, name: &str) -> Result<Template> {
    let (description, is_public, files) = with_db(|conn| {
        let (desc, pub_): (String, bool) = conn.query_row(
            "SELECT description, public FROM gists WHERE id = ?1",
            params![gist_id],
            |r| Ok((r.get(0)?, r.get::<_, i32>(1)? != 0)),
        )?;
        let files: Vec<(String, String)> = conn
            .prepare(
                "SELECT filename, COALESCE(content,'') FROM files WHERE gist_id=?1 ORDER BY rowid",
            )?
            .query_map(params![gist_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?;
        Ok((desc, pub_, files))
    })?;
    create_template(name, &description, is_public, &files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{ensure_test_db, with_db};

    #[test]
    fn create_fetch_update_delete_cycle() {
        ensure_test_db();

        let created = create_template(
            "Test Template",
            "a description",
            true,
            &[
                ("a.py".to_string(), "print()".to_string()),
                ("b.txt".to_string(), "hi".to_string()),
            ],
        )
        .unwrap();
        assert_eq!(created.name, "Test Template");
        assert!(created.is_public);
        assert_eq!(created.files.len(), 2);
        // files come back ordered by sort_order.
        assert_eq!(created.files[0].filename, "a.py");
        assert_eq!(created.files[1].filename, "b.txt");

        // Visible in the list.
        assert!(list_templates().unwrap().iter().any(|t| t.id == created.id));

        // Update replaces metadata and the entire file set.
        let updated = update_template(
            created.id,
            "Renamed",
            "new desc",
            false,
            &[("only.rs".to_string(), "fn main() {}".to_string())],
        )
        .unwrap();
        assert_eq!(updated.name, "Renamed");
        assert!(!updated.is_public);
        assert_eq!(updated.files.len(), 1);
        assert_eq!(updated.files[0].filename, "only.rs");

        // Delete removes it.
        delete_template(created.id).unwrap();
        assert!(list_templates().unwrap().iter().all(|t| t.id != created.id));
    }

    #[test]
    fn save_gist_as_template_copies_files() {
        ensure_test_db();

        // Seed a gist with two files.
        with_db(|conn| {
            conn.execute(
                "INSERT INTO gists(id, description, public, created_at, updated_at)
                 VALUES('sg1', 'Source Gist', 1, '2024-01-01', '2024-01-01')",
                [],
            )?;
            conn.execute(
                "INSERT INTO files(gist_id, filename, content) VALUES('sg1', 'one.py', 'x=1')",
                [],
            )?;
            conn.execute(
                "INSERT INTO files(gist_id, filename, content) VALUES('sg1', 'two.py', 'y=2')",
                [],
            )?;
            Ok(())
        })
        .unwrap();

        let tmpl = save_gist_as_template("sg1", "From Gist").unwrap();
        assert_eq!(tmpl.name, "From Gist");
        assert_eq!(tmpl.description, "Source Gist");
        assert!(tmpl.is_public);
        assert_eq!(tmpl.files.len(), 2);
        let names: Vec<&str> = tmpl.files.iter().map(|f| f.filename.as_str()).collect();
        assert!(names.contains(&"one.py"));
        assert!(names.contains(&"two.py"));
    }
}
