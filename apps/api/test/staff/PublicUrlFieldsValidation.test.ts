// Port of apps/api/src/test/java/org/ceitba/api/web/staff/dto/PublicUrlFieldsValidationTest.java
// URL fields the public site renders as links/images only take absolute
// http(s) URLs (or blank): a javascript: href would run in a visitor's browser.
import { describe, expect, test } from 'bun:test';
import { BEAN_MESSAGES, isHibernateEmail } from '../../src/lib/beanConstraints';
import {
  CreateBenefitCardRequest, CreateStaffMemberRequest, UpdateBenefitCardRequest, UpdateBenefitRequest, UpdateStaffMemberRequest,
} from '../../src/features/staff/logic/requests';
import { INTEROP } from '../interop/java-golden';
import { paths, violations } from './support/violations';

const EVIL = 'javascript:alert(document.cookie)';
const OK = 'https://example.com/x.png';

const member = (photoUrl: string | null, linkedinUrl: string | null) =>
  ({ year: 2026, departmentSlug: 'it', displayOrder: 0, name: 'Ana', roleEs: 'Rol', roleEn: 'Role', photoUrl, linkedinUrl, email: null });
const card = (imageUrl: string | null, ctaUrl: string | null) => ({
  categorySlug: 'gym', displayOrder: 0, titleEs: 'T', titleEn: 'T', summaryEs: null, summaryEn: null, imageUrl, ctaUrl,
  ctaLabelEs: null, ctaLabelEn: null, price: null, bulletsEs: [], bulletsEn: [], location: null, locationUrl: null, phone: null,
  website: null, email: null,
});
const benefit = (linkUrl: string) =>
  ({ colorVar: '--c', displayOrder: 0, linkUrl, contactEmail: null, highlightsEs: [], highlightsEn: [], nameEs: null, nameEn: null });

describe('PublicUrlFieldsValidationTest', () => {
  test('staffMemberUrlsRejectNonHttpSchemes', () => {
    expect(paths(CreateStaffMemberRequest, member(EVIL, EVIL))).toEqual(['linkedinUrl', 'photoUrl']);
    expect(paths(UpdateStaffMemberRequest, member('data:text/html,x', 'javascript:x'))).toEqual(['linkedinUrl', 'photoUrl']);
  });

  test('staffMemberUrlsAcceptHttpBlankAndNull', () => {
    expect(violations(CreateStaffMemberRequest, member(OK, 'http://linkedin.com/in/ana'))).toEqual([]);
    expect(violations(UpdateStaffMemberRequest, member('', null))).toEqual([]);
  });

  test('benefitCardUrlsRejectNonHttpSchemes', () => {
    expect(paths(CreateBenefitCardRequest, card(EVIL, EVIL))).toEqual(['ctaUrl', 'imageUrl']);
    expect(paths(UpdateBenefitCardRequest, card(EVIL, 'JavaScript:x'))).toEqual(['ctaUrl', 'imageUrl']);
  });

  test('benefitCardUrlsAcceptHttpBlankAndNull', () => {
    expect(violations(CreateBenefitCardRequest, card(OK, 'https://gym.example/promo'))).toEqual([]);
    expect(violations(UpdateBenefitCardRequest, card(null, ''))).toEqual([]);
  });

  test('benefitLinkUrlRejectsNonHttpSchemes', () => {
    expect(paths(UpdateBenefitRequest, benefit(EVIL))).toEqual(['linkUrl']);
    expect(violations(UpdateBenefitRequest, benefit(OK))).toEqual([]);
  });
});

const SCHEMAS = { CreateStaffMemberRequest, CreateBenefitCardRequest, UpdateBenefitRequest } as const;

describe('interop: staff DTO violations against Hibernate Validator', () => {
  test('same paths and messages for a matrix of requests', () => {
    for (const c of INTEROP.validation?.staff ?? []) {
      expect(violations(SCHEMAS[c.dto as keyof typeof SCHEMAS], c.input)).toEqual(c.violations);
    }
  });
  test('@Email agrees with Hibernate on a matrix of addresses', () => {
    for (const [address, valid] of INTEROP.validation?.emails ?? []) expect([address, isHibernateEmail(address)]).toEqual([address, valid]);
  });
});

describe('interop: Spanish (Accept-Language: es) messages', () => {
  test('the es table matches ValidationMessages_es of hibernate-validator', () => {
    const b = INTEROP.validation.esBundle;
    expect(BEAN_MESSAGES.es.notBlank).toBe(b.NotBlank);
    expect(BEAN_MESSAGES.es.notNull).toBe(b.NotNull);
    expect(BEAN_MESSAGES.es.email).toBe(b.Email);
    expect(BEAN_MESSAGES.es.size(0, 9)).toBe(b.Size.replace('{min}', '0').replace('{max}', '9'));
    expect(BEAN_MESSAGES.es.pattern('x')).toBe(b.Pattern.replace('{regexp}', 'x'));
    expect(BEAN_MESSAGES.es.min(5)).toBe(b.Min.replace('{value}', '5'));
  });
});
