import { execSync } from 'node:child_process';

/**
 * Ports used by SalesAI in local development.
 * 5001: API (Express + Socket.IO)
 * 5173: Console (Vite)
 * 5174: Visitor (Vite)
 * 7880: LiveKit
 */
const PORTS = [5001, 5173, 5174, 7880];

let killed = 0;

for (const port of PORTS) {
    try {
        const stdout = execSync(`netstat -ano | findstr :${port}`).toString();
        const pids = new Set();
        for (const line of stdout.split('\r\n')) {
            if (!line.includes('LISTENING')) continue;
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== '0' && !Number.isNaN(Number(pid))) pids.add(pid);
        }
        for (const pid of pids) {
            try {
                execSync(`taskkill /F /PID ${pid}`);
                killed++;
            } catch {
                // process already gone
            }
        }
    } catch {
        // port not in use
    }
}

console.log(killed === 0 ? 'No listening ports found.' : `Stopped ${killed} process(es).`);
