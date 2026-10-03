/* Read-only macOS process metadata. Never reads argv, environment or file contents. */
#define _DARWIN_C_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <limits.h>
#ifdef __APPLE__
#include <unistd.h>
#include <sys/sysctl.h>
#include <sys/user.h>
#include <libproc.h>
static int inspect(pid_t pid, struct kinfo_proc *info) {
    int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
    size_t size = sizeof(*info);
    return !sysctl(mib, 4, info, &size, NULL, 0) && size == sizeof(*info) &&
        info->kp_proc.p_pid == pid && info->kp_eproc.e_ucred.cr_uid == getuid();
}
static void json_string(const char *text) {
    putchar('"');
    for (const unsigned char *p=(const unsigned char *)text; *p; p++) {
        if (*p == '"' || *p == '\\') {putchar('\\');putchar(*p);}
        else if (*p < 32) printf("\\u%04x", *p);
        else putchar(*p);
    }
    putchar('"');
}
#endif
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    char *end = NULL; errno = 0;
    long value = strtol(argv[1], &end, 10);
    if (errno || !end || *end || value <= 0 || value > INT_MAX) return 2;
#ifdef __APPLE__
    struct kinfo_proc shell, foreground, after;
    if (!inspect((pid_t)value, &shell)) return 1;
    pid_t pid = shell.kp_eproc.e_tpgid;
    if (pid <= 0 || !inspect(pid, &foreground)) return 1;
    char path[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pidpath(pid, path, sizeof(path)) <= 0) return 1;
    // Reject a foreground switch or PID reuse during the inspection.
    if (!inspect((pid_t)value, &after) || after.kp_eproc.e_tpgid != pid ||
        after.kp_proc.p_starttime.tv_sec != shell.kp_proc.p_starttime.tv_sec ||
        after.kp_proc.p_starttime.tv_usec != shell.kp_proc.p_starttime.tv_usec) return 1;
    if (!inspect(pid, &after) || after.kp_proc.p_starttime.tv_sec != foreground.kp_proc.p_starttime.tv_sec ||
        after.kp_proc.p_starttime.tv_usec != foreground.kp_proc.p_starttime.tv_usec) return 1;
    // exec() preserves PID/start time. Recheck the executable as well.
    char verified_path[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pidpath(pid, verified_path, sizeof(verified_path)) <= 0 || strcmp(path, verified_path)) return 1;
    printf("{\"pid\":%d,\"startedAt\":\"%lld:%d\",\"name\":", pid,
        (long long)foreground.kp_proc.p_starttime.tv_sec, (int)foreground.kp_proc.p_starttime.tv_usec);
    json_string(foreground.kp_proc.p_comm); printf(",\"executable\":"); json_string(path); puts("}");
    return 0;
#else
    return 2;
#endif
}
