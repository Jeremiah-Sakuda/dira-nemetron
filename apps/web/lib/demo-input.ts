type Email = {from: string; subject: string; body: string};
export function demoEmailEdited(draft: Email | null, preset: Email | undefined): boolean {
  return Boolean(draft && preset && (draft.from !== preset.from || draft.subject !== preset.subject || draft.body !== preset.body));
}
