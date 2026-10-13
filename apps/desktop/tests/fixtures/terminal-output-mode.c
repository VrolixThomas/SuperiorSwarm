#include <stdio.h>
#include <termios.h>
#include <unistd.h>

// Simulate a TUI that leaves output processing disabled on exit.
int main(void) {
    struct termios mode;
    if (tcgetattr(STDIN_FILENO, &mode)) return 80;
    mode.c_oflag &= ~(OPOST | ONLCR);
    mode.c_lflag &= ~(ICANON | ECHO);
    mode.c_cc[VMIN] = 1;
    mode.c_cc[VTIME] = 0;
    if (tcsetattr(STDIN_FILENO, TCSANOW, &mode)) return 81;
    puts("__RAW_READY__\nraw-two");
    fflush(stdout);
    char input;
    if (read(STDIN_FILENO, &input, 1) != 1) return 82;
    if (tcgetattr(STDIN_FILENO, &mode)) return 83;
    if (mode.c_oflag & (OPOST | ONLCR)) return 84;
    puts("__RAW_UNCHANGED__");
    fflush(stdout);
    return 23;
}
