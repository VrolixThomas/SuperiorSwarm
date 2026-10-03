/* Disposable local TUI. Records bytes only from its own test PTY; no provider. */
#include <fcntl.h>
#include <stdlib.h>
#include <termios.h>
#include <unistd.h>
int main(void) {
    const char *path = getenv("SS_FIXTURE_CAPTURE");
    if (!path) return 2;
    int output = open(path, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (output < 0) return 3;
    struct termios mode;
    if (tcgetattr(STDIN_FILENO, &mode)) return 4;
    cfmakeraw(&mode);
    if (tcsetattr(STDIN_FILENO, TCSANOW, &mode)) return 5;
    const char ready[] = "\033[?2004hFIXTURE_READY";
    write(STDOUT_FILENO, ready, sizeof(ready)-1);
    char buffer[4096];
    ssize_t count;
    while ((count = read(STDIN_FILENO, buffer, sizeof(buffer))) > 0) {
        if (write(output, buffer, count) != count) return 6;
    }
    close(output);
    return 0;
}
