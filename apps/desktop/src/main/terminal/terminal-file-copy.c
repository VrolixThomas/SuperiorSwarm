/* Narrow POSIX worker. No shell, parsing of file contents, recursive traversal,
 * user-chosen destination, or permission widening. Source arrives on fd 3.
 * Destination operations stay relative to no-follow directory descriptors. */
#define _DARWIN_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static volatile sig_atomic_t cancelled = 0;
static void cancel_copy(int signal_number) { (void)signal_number; cancelled = 1; }
static int safe_id(const char *id) {
    if (strlen(id) != 36) return 0;
    for (int i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) { if (id[i] != '-') return 0; }
        else if (!((id[i] >= '0' && id[i] <= '9') || (id[i] >= 'a' && id[i] <= 'f'))) return 0;
    }
    return 1;
}
static int directory_at(int fd, const char *name, int create) {
    if (create && mkdirat(fd, name, 0700) < 0 && errno != EEXIST) return -1;
    int result = openat(fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    struct stat st;
    if (result >= 0 && (fstat(result, &st) < 0 || st.st_uid != getuid() || (st.st_mode & 0022))) {
        close(result); return -1;
    }
    return result;
}
static int root_directory(const char *path) {
    if (path[0] != '/') return -1;
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    char *copy = strdup(path), *state = NULL;
    if (!copy) { close(fd); return -1; }
    for (char *part = strtok_r(copy, "/", &state); part; part = strtok_r(NULL, "/", &state)) {
        if (!strcmp(part, ".") || !strcmp(part, "..")) { close(fd); fd = -1; break; }
        int next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        close(fd); fd = next;
        if (fd < 0) break;
    }
    free(copy); return fd;
}
static int write_all(int fd, const void *data, size_t length) {
    const char *p = data;
    while (length) {
        if (cancelled) return -1;
        ssize_t n = write(fd, p, length);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) return -1;
        p += n; length -= (size_t)n;
    }
    return 0;
}
static int same(const struct stat *a, const struct stat *b) {
#ifdef __APPLE__
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_size == b->st_size &&
        a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
        a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
#else
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_size == b->st_size &&
        a->st_mtim.tv_sec == b->st_mtim.tv_sec && a->st_mtim.tv_nsec == b->st_mtim.tv_nsec &&
        a->st_ctim.tv_sec == b->st_ctim.tv_sec && a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
#endif
}
static int same_directory(int parent, const char *name, int fd) {
    struct stat path, descriptor;
    return !fstatat(parent, name, &path, AT_SYMLINK_NOFOLLOW) && !fstat(fd, &descriptor) &&
        S_ISDIR(path.st_mode) && path.st_dev == descriptor.st_dev && path.st_ino == descriptor.st_ino;
}
static int contained(int root, int app, int attachments, int dir, const char *id) {
    return same_directory(root, ".superiorswarm", app) && same_directory(app, "attachments", attachments) && same_directory(attachments, id, dir);
}
static int exclude_files(int root) {
    const char *pattern = "/.superiorswarm/attachments/";
    int info = directory_at(root, "info", 1), file = -1, result = 1;
    char *text = NULL; struct stat st;
    if (info < 0) return 1;
    file = openat(info, "exclude", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (file < 0 && errno == ENOENT) {
        file = openat(info, "exclude", O_RDWR | O_APPEND | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    }
    if (file < 0 || fstat(file, &st) || !S_ISREG(st.st_mode) || st.st_size > 1024*1024) goto done;
    text = calloc((size_t)st.st_size + 1, 1); if (!text) goto done;
    size_t offset = 0;
    while (offset < (size_t)st.st_size) {
        ssize_t n = read(file, text + offset, (size_t)st.st_size - offset);
        if (n <= 0) goto done;
        offset += (size_t)n;
    }
    while (offset && (text[offset-1] == '\n' || text[offset-1] == '\r')) offset--;
    size_t length = strlen(pattern);
    if (offset >= length && !memcmp(text + offset-length, pattern, length) &&
        (offset == length || text[offset-length-1] == '\n')) {result = 0; goto done;}
    close(file);
    file = openat(info, "exclude", O_WRONLY | O_APPEND | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    struct stat current;
    if (file < 0 || fstat(file, &current) || !S_ISREG(current.st_mode) || !same(&st, &current) || !same_directory(root, "info", info)) goto done;
    const char *block = "\n# superiorswarm: local terminal attachments\n/.superiorswarm/attachments/\n";
    if (write_all(file, block, strlen(block)) || fsync(file)) goto done;
    result = 0;
done:
    free(text); if (file >= 0) close(file); close(info); return result;
}
int main(int argc, char **argv) {
    if (argc != 7 || !safe_id(argv[3])) return 2;
    const int copying = !strcmp(argv[1], "copy");
    const int excluding = !strcmp(argv[1], "exclude");
    if (!copying && !excluding && strcmp(argv[1], "delete")) return 2;
    umask(0077);
    struct sigaction action; memset(&action, 0, sizeof(action)); action.sa_handler = cancel_copy;
    sigaction(SIGTERM, &action, NULL); sigaction(SIGINT, &action, NULL); sigaction(SIGXFSZ, &action, NULL);
    int root = root_directory(argv[2]), app = -1, attachments = -1, dir = -1, output = -1;
    int result = 1, created = 0, published = 0;
    struct stat root_stat, source, after;
    if (root < 0 || fstat(root, &root_stat) || (uint64_t)root_stat.st_dev != strtoull(argv[4], NULL, 10) ||
        (uint64_t)root_stat.st_ino != strtoull(argv[5], NULL, 10)) goto done;
    if (excluding) { result = exclude_files(root); goto done; }
    app = directory_at(root, ".superiorswarm", copying); if (app < 0) { if (!copying && errno == ENOENT) result = 0; goto done; }
    attachments = directory_at(app, "attachments", copying); if (attachments < 0) { if (!copying && errno == ENOENT) result = 0; goto done; }
    if (copying) {
        if (fstat(3, &source) || !S_ISREG(source.st_mode) || source.st_size < 0 ||
            (uint64_t)source.st_size != strtoull(argv[6], NULL, 10) || source.st_size > (int64_t)2*1024*1024*1024) goto done;
        struct statvfs disk;
        if (fstatvfs(attachments, &disk) || (uint64_t)disk.f_bavail * disk.f_frsize < (uint64_t)source.st_size + 1024*1024) goto done;
        if (mkdirat(attachments, argv[3], 0700)) goto done;
        created = 1;
    }
    dir = directory_at(attachments, argv[3], 0);
    if (dir < 0) { if (!copying && errno == ENOENT) result = 0; goto done; }
    if (!copying) {
        int marker = openat(dir, "owner", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
        char id[37] = {0}; struct stat mark;
        if (marker < 0) goto done;
        int valid = !fstat(marker, &mark) && S_ISREG(mark.st_mode) && mark.st_size == 36 && read(marker, id, 36) == 36 && !strcmp(id, argv[3]);
        close(marker); if (!valid) goto done;
        struct stat entry;
        if (!fstatat(dir, "file", &entry, AT_SYMLINK_NOFOLLOW)) {
            if (!S_ISREG(entry.st_mode) || (strcmp(argv[6], "0") && (uint64_t)entry.st_ino != strtoull(argv[6], NULL, 10))) goto done;
            if (unlinkat(dir, "file", 0)) goto done;
        } else if (errno != ENOENT) goto done;
        // Never recurse and never follow unknown entries or links.
        unlinkat(dir, "partial", 0);
        if (unlinkat(dir, "owner", 0) || unlinkat(attachments, argv[3], AT_REMOVEDIR)) goto done;
        result = 0; goto done;
    }
    int marker = openat(dir, "owner", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (marker < 0) goto done;
    int marked = write_all(marker, argv[3], 36) == 0 && fsync(marker) == 0;
    close(marker); if (!marked) goto done;
    output = openat(dir, "partial", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (output < 0) goto done;
    char buffer[256*1024]; uint64_t total = 0;
    while (!cancelled) {
        ssize_t n = read(3, buffer, sizeof(buffer));
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) goto done;
        if (!n) break;
        total += (uint64_t)n;
        if (!contained(root, app, attachments, dir, argv[3]) || total > (uint64_t)source.st_size || write_all(output, buffer, (size_t)n)) goto done;
        printf("%llu\n", (unsigned long long)total); fflush(stdout);
    }
    if (cancelled || total != (uint64_t)source.st_size || fstat(3, &after) || !same(&source, &after) || fsync(output)) goto done;
    // linkat provides atomic publication without rename's overwrite behavior.
    // Both links refer to our new bytes, never to the source file.
    int current_root = root_directory(argv[2]); struct stat current;
    int root_matches = current_root >= 0 && !fstat(current_root, &current) && current.st_dev == root_stat.st_dev && current.st_ino == root_stat.st_ino;
    if (current_root >= 0) close(current_root);
    if (!root_matches || !contained(root, app, attachments, dir, argv[3])) goto done;
    if (linkat(dir, "partial", dir, "file", 0)) goto done;
    published = 1;
    if (unlinkat(dir, "partial", 0) || fsync(dir) || cancelled) goto done;
    result = 0;
done:
    if (output >= 0) close(output);
    if (result && created && dir >= 0 && contained(root, app, attachments, dir, argv[3])) {
        if (published) unlinkat(dir, "file", 0);
        unlinkat(dir, "partial", 0); unlinkat(dir, "owner", 0);
        unlinkat(attachments, argv[3], AT_REMOVEDIR);
    }
    if (dir >= 0) close(dir);
    if (attachments >= 0) close(attachments);
    if (app >= 0) close(app);
    if (root >= 0) close(root);
    // Deliberately do not log paths or OS error strings.
    return cancelled ? 3 : result;
}
