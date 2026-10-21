// Port of apps/api/src/test/java/org/ceitba/api/service/user/SocialHandlesTest.java
// (one test per @ParameterizedTest row, JUnit's "[n] args" naming).
import { describe, expect, test } from 'bun:test';
import { ValidationError } from '../../src/http/errors';
import { discord, instagram, linkedin } from '../../src/features/user/logic/socialHandles';
import { INTEROP } from '../interop/java-golden';

describe('SocialHandlesTest', () => {
  test("linkedinNormalizes [1] jane-doe, jane-doe", () => {
    expect(linkedin("jane-doe")).toBe("jane-doe");
  });
  test("linkedinNormalizes [2] @Jane-Doe, jane-doe", () => {
    expect(linkedin("@Jane-Doe")).toBe("jane-doe");
  });
  test("linkedinNormalizes [3] linkedin.com/in/jane-doe, jane-doe", () => {
    expect(linkedin("linkedin.com/in/jane-doe")).toBe("jane-doe");
  });
  test("linkedinNormalizes [4] https://www.linkedin.com/in/jane-doe/, jane-doe", () => {
    expect(linkedin("https://www.linkedin.com/in/jane-doe/")).toBe("jane-doe");
  });
  test("linkedinNormalizes [5] http://ar.linkedin.com/in/Jane-Doe?trk=abc, jane-doe", () => {
    expect(linkedin("http://ar.linkedin.com/in/Jane-Doe?trk=abc")).toBe("jane-doe");
  });
  test("linkedinNormalizes [6] HTTPS://LINKEDIN.COM/in/jane-doe/details/experience, jane-doe", () => {
    expect(linkedin("HTTPS://LINKEDIN.COM/in/jane-doe/details/experience")).toBe("jane-doe");
  });
  test("linkedinNormalizes [7] josé-pérez, josé-pérez", () => {
    expect(linkedin("josé-pérez")).toBe("josé-pérez");
  });
  test("linkedinNormalizes [8] https://www.linkedin.com/in/jos%C3%A9-p%C3%A9rez, josé-pérez", () => {
    expect(linkedin("https://www.linkedin.com/in/jos%C3%A9-p%C3%A9rez")).toBe("josé-pérez");
  });
  test("linkedinNormalizes [9] https://www.linkedin.com/in/Jos%C3%A9-P%C3%A9rez/, josé-pérez", () => {
    expect(linkedin("https://www.linkedin.com/in/Jos%C3%A9-P%C3%A9rez/")).toBe("josé-pérez");
  });
  test("linkedinRejects [1] ab", () => {
    expect(() => linkedin("ab")).toThrow(ValidationError);
  });
  test("linkedinRejects [2] https://linkedin.com/company/acme", () => {
    expect(() => linkedin("https://linkedin.com/company/acme")).toThrow(ValidationError);
  });
  test("linkedinRejects [3] https://linkedin.com/", () => {
    expect(() => linkedin("https://linkedin.com/")).toThrow(ValidationError);
  });
  test("linkedinRejects [4] jane doe", () => {
    expect(() => linkedin("jane doe")).toThrow(ValidationError);
  });
  test("linkedinRejects [5] https://notlinkedin.com/in/jane", () => {
    expect(() => linkedin("https://notlinkedin.com/in/jane")).toThrow(ValidationError);
  });
  test("linkedinRejects [6] jane_doe", () => {
    expect(() => linkedin("jane_doe")).toThrow(ValidationError);
  });
  test("linkedinRejects [7] https://linkedin.com/in/jane%ZZdoe", () => {
    expect(() => linkedin("https://linkedin.com/in/jane%ZZdoe")).toThrow(ValidationError);
  });
  test("linkedinRejects [8] https://linkedin.com/in/jane%20doe", () => {
    expect(() => linkedin("https://linkedin.com/in/jane%20doe")).toThrow(ValidationError);
  });
  test("linkedinRejects [9] https://linkedin.com/in/jane+doe", () => {
    expect(() => linkedin("https://linkedin.com/in/jane+doe")).toThrow(ValidationError);
  });
  test("instagramNormalizes [1] jane.doe, jane.doe", () => {
    expect(instagram("jane.doe")).toBe("jane.doe");
  });
  test("instagramNormalizes [2] @Jane_Doe, jane_doe", () => {
    expect(instagram("@Jane_Doe")).toBe("jane_doe");
  });
  test("instagramNormalizes [3] instagram.com/jane.doe, jane.doe", () => {
    expect(instagram("instagram.com/jane.doe")).toBe("jane.doe");
  });
  test("instagramNormalizes [4] https://www.instagram.com/jane.doe/?hl=es, jane.doe", () => {
    expect(instagram("https://www.instagram.com/jane.doe/?hl=es")).toBe("jane.doe");
  });
  test("instagramRejects [1] https://instagram.com/", () => {
    expect(() => instagram("https://instagram.com/")).toThrow(ValidationError);
  });
  test("instagramRejects [2] jane-doe", () => {
    expect(() => instagram("jane-doe")).toThrow(ValidationError);
  });
  test("instagramRejects [3] aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", () => {
    expect(() => instagram("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow(ValidationError);
  });
  test("instagramRejects [4] https://example.com/jane", () => {
    expect(() => instagram("https://example.com/jane")).toThrow(ValidationError);
  });
  test("instagramRejects [5] https://www.instagram.com/p/C0dE123abc/", () => {
    expect(() => instagram("https://www.instagram.com/p/C0dE123abc/")).toThrow(ValidationError);
  });
  test("instagramRejects [6] https://instagram.com/reel/C0dE123abc", () => {
    expect(() => instagram("https://instagram.com/reel/C0dE123abc")).toThrow(ValidationError);
  });
  test("instagramRejects [7] https://instagram.com/reels/C0dE123abc/", () => {
    expect(() => instagram("https://instagram.com/reels/C0dE123abc/")).toThrow(ValidationError);
  });
  test("instagramRejects [8] https://instagram.com/stories/jane.doe/123", () => {
    expect(() => instagram("https://instagram.com/stories/jane.doe/123")).toThrow(ValidationError);
  });
  test("instagramRejects [9] https://instagram.com/explore/", () => {
    expect(() => instagram("https://instagram.com/explore/")).toThrow(ValidationError);
  });
  test("instagramRejects [10] https://instagram.com/tv/C0dE123abc", () => {
    expect(() => instagram("https://instagram.com/tv/C0dE123abc")).toThrow(ValidationError);
  });
  test("instagramRejects [11] https://instagram.com/accounts/login/", () => {
    expect(() => instagram("https://instagram.com/accounts/login/")).toThrow(ValidationError);
  });
  test("instagramRejects [12] https://instagram.com/P/abc", () => {
    expect(() => instagram("https://instagram.com/P/abc")).toThrow(ValidationError);
  });
  test("instagramRejects [13] https://instagram.com/jane.doe/tagged/", () => {
    expect(() => instagram("https://instagram.com/jane.doe/tagged/")).toThrow(ValidationError);
  });
  test("discordNormalizes [1] jane.doe, jane.doe", () => {
    expect(discord("jane.doe")).toBe("jane.doe");
  });
  test("discordNormalizes [2] @Jane_Doe, jane_doe", () => {
    expect(discord("@Jane_Doe")).toBe("jane_doe");
  });
  test("discordNormalizes [3] Old Name#0420, Old Name#0420", () => {
    expect(discord("Old Name#0420")).toBe("Old Name#0420");
  });
  test("discordNormalizes [4] Ñandú Rojo#0001, Ñandú Rojo#0001", () => {
    expect(discord("Ñandú Rojo#0001")).toBe("Ñandú Rojo#0001");
  });
  test("discordRejects [1] j", () => {
    expect(() => discord("j")).toThrow(ValidationError);
  });
  test("discordRejects [2] jane doe", () => {
    expect(() => discord("jane doe")).toThrow(ValidationError);
  });
  test("discordRejects [3] jane#12", () => {
    expect(() => discord("jane#12")).toThrow(ValidationError);
  });
  test("discordRejects [4] a@b#1234", () => {
    expect(() => discord("a@b#1234")).toThrow(ValidationError);
  });
  test("discordRejects [5] aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", () => {
    expect(() => discord("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toThrow(ValidationError);
  });
  test("discordRejects [6] aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#1234", () => {
    expect(() => discord("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa#1234")).toThrow(ValidationError);
  });
  test("discordRejects [7] Old\\tName#0420", () => {
    expect(() => discord("Old\tName#0420")).toThrow(ValidationError);
  });
  test("discordRejects [8] Old\\nName#0420", () => {
    expect(() => discord("Old\nName#0420")).toThrow(ValidationError);
  });
  test("discordRejects [9] Old\\u00A0Name#0420", () => {
    expect(() => discord("Old\u00A0Name#0420")).toThrow(ValidationError);
  });
  test("discordRejects [10] Old  Name#0420", () => {
    expect(() => discord("Old  Name#0420")).toThrow(ValidationError);
  });
  test("discordRejects [11] Old \\u0000#0420", () => {
    expect(() => discord("Old \u0000#0420")).toThrow(ValidationError);
  });
  test("discordRejects [12] Old\\u200BName#0420", () => {
    expect(() => discord("Old\u200BName#0420")).toThrow(ValidationError);
  });
  test("discordRejects [13] Name #0420", () => {
    expect(() => discord("Name #0420")).toThrow(ValidationError);
  });
  test("discordRejects [14] Na\\u0007me#0420", () => {
    expect(() => discord("Na\u0007me#0420")).toThrow(ValidationError);
  });
});

describe('interop: SocialHandles against Java', () => {
  test('same handle or same ValidationException message for a matrix of inputs', () => {
    const fns = { linkedin, instagram, discord } as Record<string, (s: string) => string>;
    for (const [f, input, expected] of INTEROP.socialHandles) {
      let got: string;
      try {
        got = fns[f]!(input);
      } catch (e) {
        got = `ERR ${(e as Error).message}`;
      }
      expect([f, input, got]).toEqual([f, input, expected]);
    }
  });
});
