import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateOrReservedIp(host) {
    const version = isIP(host);
    if (version === 4) {
        const [a, b] = host.split('.').map(Number);
        if (a === 10) return true;                          // 10.0.0.0/8
        if (a === 127) return true;                         // 127.0.0.0/8
        if (a === 169 && b === 254) return true;            // 169.254.0.0/16
        if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
        if (a === 192 && b === 168) return true;            // 192.168.0.0/16
        if (a === 0) return true;                           // 0.0.0.0/8
        return false;
    }
    if (version === 6) {
        const h = host.toLowerCase();
        return h === '::1'
            || h.startsWith('fe80:')
            || h.startsWith('fc') || h.startsWith('fd');
    }
    return false;
}

/**
 * An SSRF-protected fetch wrapper.
 * It resolves the hostname to an IP address before sending the request,
 * and aborts if the IP resolves to a private or reserved network.
 * By passing the resolved IP to fetch but setting the Host header,
 * we prevent DNS rebinding attacks (time-of-check to time-of-use).
 */
export async function safeFetch(urlStr, options = {}) {
    const url = new URL(urlStr);
    
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('SSRF Guard: Only HTTP/HTTPS protocols are allowed.');
    }

    if (isPrivateOrReservedIp(url.hostname)) {
        throw new Error(`SSRF Guard: IP ${url.hostname} is private/reserved.`);
    }

    // Resolve DNS
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses || addresses.length === 0) {
        throw new Error('SSRF Guard: Could not resolve hostname.');
    }
    
    // Check all resolved IPs to ensure none are private
    for (const record of addresses) {
        if (isPrivateOrReservedIp(record.address)) {
            throw new Error(`SSRF Guard: Hostname resolves to private IP: ${record.address}`);
        }
    }

    // Connect to the first resolved IP to prevent DNS rebinding TOCTOU.
    const ip = addresses[0].address;
    const isIPv6 = isIP(ip) === 6;
    const ipFormatted = isIPv6 ? `[${ip}]` : ip;
    
    const safeUrlStr = `${url.protocol}//${ipFormatted}${url.port ? ':' + url.port : ''}${url.pathname}${url.search}`;

    const safeOptions = {
        ...options,
        headers: {
            ...options.headers,
            'Host': url.hostname // explicitly set the original Host header
        }
    };

    return fetch(safeUrlStr, safeOptions);
}
