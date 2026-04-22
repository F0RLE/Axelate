import { describe, expect, it } from 'vitest';
import { formatSmartRate, scaleThroughputToPercent } from './MonitoringUI';

describe('formatSmartRate', () => {
    it('formats sub-megabyte throughput without rounding it down to zero', () => {
        expect(formatSmartRate(512 * 1024, 256 * 1024)).toEqual({
            val1: '512',
            val2: '256',
            unit: 'KB/s',
        });
    });

    it('keeps one decimal for low megabyte throughput', () => {
        expect(formatSmartRate(1.5 * 1024 * 1024, 0.5 * 1024 * 1024)).toEqual({
            val1: '1.5',
            val2: '0.5',
            unit: 'MB/s',
        });
    });

    it('switches to integer megabytes for larger throughput', () => {
        expect(formatSmartRate(12.4 * 1024 * 1024, 3.6 * 1024 * 1024)).toEqual({
            val1: '12',
            val2: '4',
            unit: 'MB/s',
        });
    });
});

describe('scaleThroughputToPercent', () => {
    it('uses a softened curve so moderate throughput stays visible', () => {
        expect(scaleThroughputToPercent(512 * 1024 * 1024, 2048)).toBe(50);
    });

    it('clamps values above the configured maximum', () => {
        expect(scaleThroughputToPercent(3000 * 1024 * 1024, 2048)).toBe(100);
    });

    it('returns zero for empty throughput', () => {
        expect(scaleThroughputToPercent(0, 2048)).toBe(0);
    });

    it('keeps low throughput visible instead of nearly empty', () => {
        expect(scaleThroughputToPercent(531 * 1024, 125)).toBeCloseTo(6.44, 2);
    });

    it('applies a minimum visible fill for non-zero activity', () => {
        expect(scaleThroughputToPercent(1, 2048)).toBe(4);
    });
});
