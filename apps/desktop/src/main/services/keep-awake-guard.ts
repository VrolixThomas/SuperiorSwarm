export const KEEP_AWAKE_LOCK = "/var/run/com.superiorswarm.keep-awake";

function shellLiteral(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * A short-lived, authorized guardian owns the system-wide sleep override.
 * It only READS the unprivileged lease path; it never executes a user-writable
 * file or writes to a user-controlled path as root. No sudoers rule is installed.
 *
 * Readiness goes through stdout. Closing that pipe lets `do shell script`
 * return while the detached guardian continues until the lease/app disappears.
 * Keep all power writes in this process so a late authorization cannot race quit.
 */
export function buildKeepAwakeCommand(ownerPid: number, leasePath: string): string {
	if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("Invalid owner PID");
	const script = `
owner_pid="$1"
lease_path="$2"
lock_path=${shellLiteral(KEEP_AWAKE_LOCK)}
changed=0

owner_alive() {
  [ -d "$lease_path" ] && kill -0 "$owner_pid" 2>/dev/null
}

# Serialize SuperiorSwarm instances without touching an existing override.
if ! /bin/mkdir "$lock_path" 2>/dev/null; then
  echo "Another SuperiorSwarm keep-awake session is active or still restoring sleep."
  exit 1
fi

cleanup() {
  trap '' HUP INT TERM
  if [ "$changed" = 1 ]; then
    # Retain ownership and retry if powerd is temporarily unavailable.
    until /usr/bin/pmset disablesleep 0; do /bin/sleep 1; done
  fi
  /bin/rmdir "$lock_path"
}
trap cleanup EXIT
trap 'exit 0' HUP INT TERM

report=$(/usr/bin/pmset -g) || exit 1
if /usr/bin/printf '%s\n' "$report" | /usr/bin/grep -Eq '^[[:space:]]*SleepDisabled[[:space:]]+1([[:space:]]|$)'; then
  echo "Sleep is already disabled by another app or system setting. Turn that off first."
  exit 1
fi
owner_alive || exit 1
# Mark before writing: even a failed write may have changed the system setting.
changed=1
/usr/bin/pmset disablesleep 1 || exit 1
owner_alive || exit 1
echo SUPERIORSWARM_KEEP_AWAKE_READY
exec >/dev/null 2>&1
while owner_alive; do /bin/sleep 1; done
`;

	return `${["/usr/bin/nohup", "/bin/sh", "-c", script, "sh", String(ownerPid), leasePath].map(shellLiteral).join(" ")} </dev/null 2>&1 &`;
}

export function buildKeepAwakeAppleScript(command: string): string {
	const literal = `"${command.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
	return `do shell script ${literal} with administrator privileges with prompt "SuperiorSwarm needs permission to keep your Mac awake with the lid closed until you turn this off or quit the app."`;
}

export function isSleepDisabled(report: string): boolean {
	return /^\s*SleepDisabled\s+1(?:\s|$)/m.test(report);
}
