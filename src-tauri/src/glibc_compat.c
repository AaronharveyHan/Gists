/* Weak forward aliases for __isoc23_strtol* symbols added in glibc 2.38.
 * The ort-sys prebuilt ONNX Runtime binary is compiled against glibc 2.38+
 * and references these names. On older glibc the linker cannot find them.
 * Defining them as __attribute__((weak)) here satisfies the linker while
 * letting the real glibc 2.38+ versions win when present (strong beats weak).
 * On older glibc at runtime our stubs delegate to the classic strto* functions,
 * which have identical semantics for all inputs ONNX Runtime actually passes. */
#ifdef __linux__
#include <stdlib.h>

__attribute__((weak))
long __isoc23_strtol(const char *s, char **e, int b) { return strtol(s, e, b); }

__attribute__((weak))
long long __isoc23_strtoll(const char *s, char **e, int b) { return strtoll(s, e, b); }

__attribute__((weak))
unsigned long long __isoc23_strtoull(const char *s, char **e, int b) { return strtoull(s, e, b); }
#endif
