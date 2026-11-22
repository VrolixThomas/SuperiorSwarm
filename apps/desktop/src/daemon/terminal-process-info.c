/* Default mode reads identity only. --environment snapshots a verified foreground process exec environment for daemon-owned resume, never argv output or file contents. */
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
    if (argc < 2 || argc > 3 || (argc == 3 && strcmp(argv[2], "--environment"))) return 2;
    int with_environment = argc == 3;
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
    char *process_args = NULL, *env_start = NULL, *args_end = NULL;
    if (with_environment) {
        int mib[] = {CTL_KERN, KERN_PROCARGS2, pid};
        int limit = 0; size_t limit_size = sizeof(limit); int limit_mib[] = {CTL_KERN, KERN_ARGMAX};
        if (sysctl(limit_mib, 2, &limit, &limit_size, NULL, 0) || limit < (int)sizeof(int) || limit > 1024*1024) return 1;
        size_t size = (size_t)limit;
        process_args = malloc(size);
        if (!process_args || sysctl(mib, 3, process_args, &size, NULL, 0)) { free(process_args); return 1; }
        int count = 0; memcpy(&count, process_args, sizeof(count));
        if (count < 0 || count > 16384) { free(process_args); return 1; }
        char *p = process_args + sizeof(int); args_end = process_args + size;
        size_t length = strnlen(p, (size_t)(args_end-p));
        if (p+length >= args_end) { free(process_args); return 1; }
        p += length + 1;
        while (p < args_end && !*p) p++;
        for (int i = 0; i < count; i++) {
            if (p >= args_end) { free(process_args); return 1; }
            length = strnlen(p, (size_t)(args_end-p));
            if (p+length >= args_end) { free(process_args); return 1; }
            p += length + 1;
        }
        while (p < args_end && !*p) p++;
        env_start = p;
        if (args_end-env_start > 128*1024) { free(process_args); return 1; }
    }
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
    json_string(foreground.kp_proc.p_comm); printf(",\"executable\":"); json_string(path);
    if (with_environment) {
        printf(",\"environment\":["); int first = 1;
        for (char *p=env_start; p < args_end && *p;) {
            size_t length = strnlen(p, (size_t)(args_end-p));
            if (p+length >= args_end) { free(process_args); return 1; }
            if (!first) putchar(','); first = 0; json_string(p); p += length+1;
        }
        putchar(']');
    }
    puts("}"); free(process_args);
    return 0;
#else
    return 2;
#endif
}
