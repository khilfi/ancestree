import { useKinshipSettings, useSaveKinshipSettings } from "@/api/queries";
import type { KinshipLanguage } from "@/api/types";
import { showError } from "@/lib/notify";
import { cn } from "@/lib/utils";

export const KINSHIP_LANGUAGES: readonly KinshipLanguage[] = ["en", "ms", "jv"];

/** The languages' own names, for headings and tooltips. */
export const LANGUAGE_NAMES: Record<KinshipLanguage, string> = {
  en: "English",
  ms: "Bahasa Melayu",
  jv: "Basa Jawa",
};

const SHORT: Record<KinshipLanguage, string> = { en: "English", ms: "Melayu", jv: "Jawa" };

/** English · Melayu · Jawa: the language of the kinship words. The choice is
 *  saved, so the answers, the Relatives tab and the dictionary all follow it. */
export function LanguageSwitch({ className }: { className?: string }) {
  const settings = useKinshipSettings();
  const save = useSaveKinshipSettings();
  const language = settings.data?.language ?? "en";

  return (
    <fieldset
      aria-label="Language of kinship words"
      className={cn("inline-flex gap-0.5 rounded-lg bg-stone-100 p-0.5", className)}
    >
      {KINSHIP_LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={language === code}
          disabled={!settings.data}
          title={`Kinship words in ${LANGUAGE_NAMES[code]}`}
          onClick={() => {
            if (settings.data && language !== code) {
              save.mutate({ ...settings.data, language: code }, { onError: showError });
            }
          }}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
            language === code
              ? "bg-white text-stone-900 shadow-sm"
              : "text-stone-600 hover:text-stone-900",
          )}
        >
          {SHORT[code]}
        </button>
      ))}
    </fieldset>
  );
}
