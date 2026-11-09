import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 能力页会把插件贡献的 Skill 与插件本身并排列出：Skill 的 displayName 一旦取
 * `%plugin.name%`，用户就看到两条同名条目（插件「红果短剧」与 Skill「红果短剧」）。
 * 同时，plugin.json 里任何 %key% 在某个语言缺失时，该语言界面会露出裸键。
 */
const root = new URL("../", import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

const manifest = readJson("plugin.json");
const locales = {
	en: readJson("locales/en.json") as Record<string, string>,
	zh: readJson("locales/zh.json") as Record<string, string>,
};

function collectStrings(value: unknown, out: string[] = []): string[] {
	if (typeof value === "string") out.push(value);
	else if (Array.isArray(value)) for (const item of value) collectStrings(item, out);
	else if (value && typeof value === "object") for (const item of Object.values(value)) collectStrings(item, out);
	return out;
}

const resolve = (raw: string, catalog: Record<string, string>): string => {
	const match = /^%([^%]+)%$/.exec(raw);
	return match ? (catalog[match[1]] ?? raw) : raw;
};

const skillPresentation = manifest.agent.skillPresentation as {
	skills: Record<string, { displayName?: string; displayDescription?: string }>;
};

describe("manifest presentation i18n", () => {
	it("every %key% placeholder in plugin.json resolves in both locales", () => {
		const placeholders = new Set(
			collectStrings(manifest)
				.filter((text) => /^%[^%]+%$/.test(text))
				.map((text) => /^%([^%]+)%$/.exec(text)![1]),
		);
		expect(placeholders.size).toBeGreaterThan(0);
		for (const [locale, catalog] of Object.entries(locales)) {
			const missing = [...placeholders].filter((key) => !(key in catalog));
			expect(missing, `${locale} 缺少键`).toEqual([]);
		}
	});

	it("the contributed Skill is not titled like the plugin itself", () => {
		for (const [locale, catalog] of Object.entries(locales)) {
			for (const rule of Object.values(skillPresentation.skills)) {
				if (!rule.displayName) continue;
				expect(resolve(rule.displayName, catalog), `${locale} Skill 名称与插件重名`).not.toBe(
					resolve(manifest.name, catalog),
				);
			}
			for (const rule of Object.values(skillPresentation.skills)) {
				if (!rule.displayDescription) continue;
				expect(resolve(rule.displayDescription, catalog), `${locale} Skill 描述与插件重复`).not.toBe(
					resolve(manifest.description, catalog),
				);
			}
		}
	});
});
