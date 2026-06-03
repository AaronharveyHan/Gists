fn main() {
    tauri_build::build();

    // On Linux, compile a C shim that provides weak definitions of the
    // __isoc23_strtol* symbols added in glibc 2.38. The prebuilt ONNX Runtime
    // binary bundled by ort-sys references these names; without the shim the
    // linker fails on any runner or end-user machine with glibc < 2.38.
    // The weak attribute ensures the real glibc 2.38+ symbols take priority.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        cc::Build::new()
            .file("src/glibc_compat.c")
            .compile("glibc_compat");
    }
}
