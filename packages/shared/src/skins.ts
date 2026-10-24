import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需要使用六位 HEX，例如 #101827');
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
export function skinContrast(first: string, second: string) {
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export const skinDesignSchema = z
  .object({
    palette: z
      .object({
        background: color,
        surface: color,
        raised: color,
        text: color,
        muted: color,
        accent: color,
        line: color,
      })
      .strict()
      .superRefine((p, ctx) => {
        for (const key of ['background', 'surface', 'raised'] as const) {
          if (skinContrast(p.text, p[key]) < 4.5)
            ctx.addIssue({
              code: 'custom',
              path: ['text'],
              message: `正文与 ${key} 的对比度需要至少 4.5，请调整配色`,
            });
        }
        if (skinContrast(p.muted, p.background) < 3)
          ctx.addIssue({
            code: 'custom',
            path: ['muted'],
            message: '辅助文字与背景的对比度需要至少 3',
          });
        if (skinContrast(p.accent, p.surface) < 3 || skinContrast(p.accent, p.background) < 3)
          ctx.addIssue({
            code: 'custom',
            path: ['accent'],
            message: '点缀色与背景及表面的对比度需要至少 3',
          });
      }),
    typography: z.enum(['sans', 'serif', 'mono']).default('sans'),
    navigation: z.enum(['rail', 'island', 'editorial']).default('island'),
    composer: z.enum(['capsule', 'underline', 'glass']).default('glass'),
    contentWidth: z.number().int().min(580).max(1100).default(820),
    surfaceRadius: z.number().min(0).max(32).default(16),
    surfaceOpacity: z.number().min(0.5).max(1).default(0.85),
    borderOpacity: z.number().min(0.05).max(0.5).default(0.15),
    letterSpacing: z.number().min(-0.5).max(1.5).default(0),
    motion: z
      .object({
        effect: z.enum(['stars', 'aurora', 'grid', 'none']).default('stars'),
        color: color.default('#88bfff'),
        density: z.number().int().min(12).max(100).default(60),
        speed: z.number().min(0.1).max(2).default(0.6),
      })
      .strict()
      .prefault({}),
  })
  .strict();
export type SkinDesign = z.infer<typeof skinDesignSchema>;
export const appearanceSchema = z.object({
  skin: z.enum(['orbit', 'paper', 'veil']).default('orbit'),
  design: skinDesignSchema.optional(),
  backgroundImage: z
    .string()
    .max(4_000_000)
    .refine(
      (v) =>
        !v ||
        /^https:\/\//.test(v) ||
        /^data:image\/(png|jpeg|webp|avif);base64,[a-zA-Z0-9+/=]+$/.test(v),
      '请选择图片或填写 HTTPS 图片地址',
    )
    .default(''),
  backgroundOpacity: z.number().min(0).max(1).default(0.25),
  backgroundBlur: z.number().min(0).max(30).default(0),
  backgroundPosition: z.enum(['center', 'top', 'bottom']).default('center'),
  animation: z.boolean().default(true),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  bubble: z.enum(['soft', 'line', 'plain']).default('soft'),
  radius: z.number().min(0).max(28).default(16),
});
export const skinPackageSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  name: z.string().min(1).max(80).default('我的皮肤'),
  description: z.string().max(500).default(''),
  theme: z.enum(['light', 'dark', 'system']).default('dark'),
  accent: z.enum(['sage', 'iris', 'ocean', 'rose']).default('sage'),
  appearance: appearanceSchema,
});
export type SkinPackage = z.infer<typeof skinPackageSchema>;
export const skinCreationSchema = skinPackageSchema
  .omit({ version: true })
  .extend({
    name: z.string().min(1).max(80),
    prompt: z.string().min(1).max(4000),
    appearance: appearanceSchema.extend({ design: skinDesignSchema }),
  })
  .strict();
export function skinSettings(skin: SkinPackage) {
  return {
    appearance: skin.appearance,
    theme: skin.theme,
    accent: skin.accent,
    activeSkinName: skin.name,
  };
}

/** Only validated tokens become CSS values. No selectors, scripts or resource loads. */
export function skinVariables(design: SkinDesign | undefined): Record<string, string> {
  if (!design) return {};
  const p = design.palette;
  const alpha = Math.round(design.borderOpacity * 255)
    .toString(16)
    .padStart(2, '0');
  return {
    '--bg': p.background,
    '--surface': p.surface,
    '--surface-2': p.raised,
    '--sidebar': p.surface,
    '--text': p.text,
    '--muted': p.muted,
    '--faint': p.muted,
    '--accent': p.accent,
    '--accent-strong': p.accent,
    '--accent-soft': p.accent + '18',
    '--accent-rgb': [1, 3, 5].map((at) => parseInt(p.accent.slice(at, at + 2), 16)).join(', '),
    '--skin-on-accent':
      skinContrast('#ffffff', p.accent) >= skinContrast('#10141c', p.accent)
        ? '#ffffff'
        : '#10141c',
    '--line': p.line + alpha,
    '--stage': p.raised,
    '--skin-width': design.contentWidth + 'px',
    '--skin-radius': design.surfaceRadius + 'px',
    '--skin-opacity': Math.round(design.surfaceOpacity * 100) + '%',
    '--skin-tracking': design.letterSpacing + 'px',
    '--skin-font':
      design.typography === 'serif'
        ? 'Georgia, "Noto Serif SC", "Songti SC", serif'
        : design.typography === 'mono'
          ? '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
          : 'ui-sans-serif, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
  };
}
