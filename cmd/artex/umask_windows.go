//go:build windows

package main

// applySecureUmask is intentionally a no-op on Windows: permissions there are
// ACL-based rather than umask-based. The explicit os.MkdirAll(0o700) and
// os.Chmod(0o600/0o700) calls in the traffic store still apply, and Go maps the
// owner bits onto the file's DACL.
func applySecureUmask() {}
