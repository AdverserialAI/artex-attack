//go:build !windows

package main

import "syscall"

// applySecureUmask restricts every file and directory this process creates to
// its own UID. ARTEX stores plaintext traffic, MITM CA key material, SQLite
// sidecars and task archives; the default 022 leaves them world-readable on a
// multi-user host. It runs before the first mkdir, so call sites that pass an
// explicit 0755/0644 (and libraries that pass none at all, such as the CA writer
// and SQLite's -wal/-shm) are all narrowed by inheritance.
func applySecureUmask() {
	syscall.Umask(0o077)
}
