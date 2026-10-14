const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count as a readable string, e.g. 1572864 -> "1.5 MB" (base 1024).
 */
export function formatBytes(n: number, decimals = 1): string {
    if (!Number.isFinite(n)) { return '0 B'; }
    const sign = n < 0 ? '-' : '';
    let value = Math.abs(n);
    let i = 0;
    while (value >= 1024 && i < UNITS.length - 1) {
        value /= 1024;
        i++;
    }
    const text = i === 0 ? String(Math.round(value)) : value.toFixed(decimals);
    return `${sign}${text} ${UNITS[i]}`;
}
