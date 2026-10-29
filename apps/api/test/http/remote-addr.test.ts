// The client IP the app sees must be the string Tomcat's getRemoteAddr() gave: vote fingerprints and analytics
// IP hashes are HMACs of it, so an IPv4-mapped form would make Bun count a client Java already counted.
import { describe, expect, test } from 'bun:test';
import { servletRemoteAddr } from '../../src/http/app';

describe('servletRemoteAddr', () => {
  test('unwrapsIpv4MappedAddresses', () => {
    expect(servletRemoteAddr('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(servletRemoteAddr('::FFFF:192.168.1.2')).toBe('192.168.1.2');
  });

  test('keepsPlainIpv4AndIpv6', () => {
    expect(servletRemoteAddr('10.0.0.5')).toBe('10.0.0.5');
    expect(servletRemoteAddr('::1')).toBe('::1');
    expect(servletRemoteAddr('2001:db8::1')).toBe('2001:db8::1');
  });
});
