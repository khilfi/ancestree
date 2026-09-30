import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactNode } from "react";
import { Controller, type UseFormRegister, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ApiError } from "@/api/errors";
import { useCreateKind, useUpdateKind } from "@/api/queries";
import type { KindView, KindWords } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { showError } from "@/lib/notify";

const wording = z.object({
  neutral: z.string().trim().min(1, "Needed.").max(60),
  male: z.string().trim().max(60),
  female: z.string().trim().max(60),
});

const optionalWording = z.object({
  neutral: z.string().trim().max(60),
  male: z.string().trim().max(60),
  female: z.string().trim().max(60),
});

// A kind's words in Malay or Javanese: all of them, or none.
const languageWords = z.object({
  label: z.string().trim().max(60),
  parent_label: optionalWording,
  child_label: optionalWording,
});

const WORD_LANGUAGES = [
  { code: "ms", name: "Bahasa Melayu", example: "angkat: bapa angkat, anak angkat" },
  { code: "jv", name: "Basa Jawa", example: "angkat: bapak angkat, anak pupon" },
] as const;

const kindSchema = z
  .object({
    label: z.string().trim().min(1, "A name is needed.").max(60),
    parent_label: wording,
    child_label: wording,
    in_layout: z.boolean(),
    words: z.object({ ms: languageWords, jv: languageWords }),
  })
  .superRefine((data, context) => {
    for (const { code } of WORD_LANGUAGES) {
      const words = data.words[code];
      const given = [
        words.label,
        ...Object.values(words.parent_label),
        ...Object.values(words.child_label),
      ];
      const complete = words.label && words.parent_label.neutral && words.child_label.neutral;
      if (given.some(Boolean) && !complete) {
        context.addIssue({
          code: "custom",
          path: ["words", code, "label"],
          message:
            "Give the kind's word and the first parent and child words, or leave them all empty.",
        });
      }
    }
  });

type KindValues = z.infer<typeof kindSchema>;
type WordingField = `${"parent_label" | "child_label"}.${"neutral" | "male" | "female"}`;
type LanguageCode = (typeof WORD_LANGUAGES)[number]["code"];

/** The words a form sends: a language only when its words are all there. */
function wordsToSend(values: KindValues): Partial<Record<LanguageCode, KindWords>> {
  const sent: Partial<Record<LanguageCode, KindWords>> = {};
  for (const { code } of WORD_LANGUAGES) {
    const words = values.words[code];
    if (words.label && words.parent_label.neutral && words.child_label.neutral) sent[code] = words;
  }
  return sent;
}

/** "Foster" suggests "foster parent", "foster father", "foster mother", "foster son"… */
function suggestions(label: string): [WordingField, string][] {
  const word = label.trim().toLowerCase();
  const say = (noun: string) => (word ? `${word} ${noun}` : "");
  return [
    ["parent_label.neutral", say("parent")],
    ["parent_label.male", say("father")],
    ["parent_label.female", say("mother")],
    ["child_label.neutral", say("child")],
    ["child_label.male", say("son")],
    ["child_label.female", say("daughter")],
  ];
}

function values(kind: KindView | null): KindValues {
  const side = (label: KindView["parent_label"] | undefined) => ({
    neutral: label?.neutral ?? "",
    male: label?.male ?? "",
    female: label?.female ?? "",
  });
  const language = (words: KindWords | undefined) => ({
    label: words?.label ?? "",
    parent_label: side(words?.parent_label),
    child_label: side(words?.child_label),
  });
  return {
    label: kind?.label ?? "",
    parent_label: side(kind?.parent_label),
    child_label: side(kind?.child_label),
    in_layout: kind?.in_layout ?? true,
    words: { ms: language(kind?.words?.ms), jv: language(kind?.words?.jv) },
  };
}

/** A kind's words in Malay and Javanese, for answers and the Relatives tab in those
 *  languages. Without them, the English words stand in. */
function LanguageWordFields({
  register,
  errors,
}: {
  register: UseFormRegister<KindValues>;
  errors: Partial<Record<LanguageCode, string | undefined>>;
}) {
  return (
    <details className="rounded-lg border border-stone-200 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">Malay and Javanese words</summary>
      <div className="mt-3 space-y-4">
        {WORD_LANGUAGES.map(({ code, name, example }) => (
          <fieldset key={code} className="space-y-2">
            <legend className="text-sm font-medium">{name}</legend>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor={`words.${code}.label`} className="text-xs text-stone-500">
                  The kind
                </Label>
                <Input
                  id={`words.${code}.label`}
                  lang={code}
                  {...register(`words.${code}.label`)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`words.${code}.parent`} className="text-xs text-stone-500">
                  The parent
                </Label>
                <Input
                  id={`words.${code}.parent`}
                  lang={code}
                  {...register(`words.${code}.parent_label.neutral`)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`words.${code}.child`} className="text-xs text-stone-500">
                  The child
                </Label>
                <Input
                  id={`words.${code}.child`}
                  lang={code}
                  {...register(`words.${code}.child_label.neutral`)}
                />
              </div>
              {(["male", "female"] as const).map((gender) => (
                <div key={gender} className="col-span-3 grid grid-cols-3 gap-2">
                  <span className="self-center text-xs text-stone-500">
                    {gender === "male" ? "For a man or boy" : "For a woman or girl"}
                  </span>
                  <Input
                    aria-label={`${name}: the parent, ${gender}`}
                    lang={code}
                    {...register(`words.${code}.parent_label.${gender}`)}
                  />
                  <Input
                    aria-label={`${name}: the child, ${gender}`}
                    lang={code}
                    {...register(`words.${code}.child_label.${gender}`)}
                  />
                </div>
              ))}
            </div>
            {errors[code] ? (
              <p className="text-xs text-red-600">{errors[code]}</p>
            ) : (
              <Hint>For example: {example}.</Hint>
            )}
          </fieldset>
        ))}
      </div>
    </details>
  );
}

function WordingFields({
  side,
  title,
  nouns,
  register,
  error,
}: {
  side: "parent_label" | "child_label";
  title: string;
  nouns: [string, string, string];
  register: UseFormRegister<KindValues>;
  error?: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{title}</legend>
      <div className="grid grid-cols-3 gap-2">
        {(["neutral", "male", "female"] as const).map((gender, index) => (
          <div key={gender} className="space-y-1">
            <Label htmlFor={`${side}.${gender}`} className="text-xs text-stone-500">
              {nouns[index]}
            </Label>
            <Input id={`${side}.${gender}`} {...register(`${side}.${gender}`)} />
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </fieldset>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-stone-500">{children}</p>;
}

/** Add a relationship kind, or change the wording of one. */
export function KindDialog({ kind, onClose }: { kind: KindView | null; onClose: () => void }) {
  const form = useForm<KindValues>({
    resolver: zodResolver(kindSchema),
    defaultValues: values(kind),
  });
  const { register, control, formState } = form;
  const { errors } = formState;
  const create = useCreateKind();
  const update = useUpdateKind();
  const saving = create.isPending || update.isPending;

  // For a new kind, wording nobody has typed in yet follows the kind's name.
  const label = register("label", {
    onChange: (event: { target: { value: string } }) => {
      if (kind) return;
      for (const [name, text] of suggestions(event.target.value)) {
        if (!form.getFieldState(name).isDirty) form.setValue(name, text);
      }
    },
  });

  const submit = form.handleSubmit(async (data) => {
    const body = { ...data, words: wordsToSend(data) };
    try {
      if (kind) {
        await update.mutateAsync({ key: kind.key, body });
        toast.success(`Saved “${data.label}”.`);
      } else {
        await create.mutateAsync(body);
        toast.success(`Added “${data.label}”. It's now offered when linking parents and children.`);
      }
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === "duplicate_kind") {
        form.setError("label", { message: error.message });
        return;
      }
      showError(error);
    }
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{kind ? `Edit “${kind.label}”` : "Add a relationship kind"}</DialogTitle>
            <DialogDescription>
              A kind of parent and child link, such as foster or guardian. It never counts as blood:
              only biological does.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="kind_label">Name</Label>
            <Input id="kind_label" placeholder="e.g. Foster" autoFocus {...label} />
            {errors.label && <p className="text-xs text-red-600">{errors.label.message}</p>}
          </div>

          <WordingFields
            side="parent_label"
            title="The parent is called"
            nouns={["Anyone", "A man", "A woman"]}
            register={register}
            error={errors.parent_label?.neutral?.message}
          />
          <WordingFields
            side="child_label"
            title="The child is called"
            nouns={["Anyone", "A boy", "A girl"]}
            register={register}
            error={errors.child_label?.neutral?.message}
          />
          <Hint>
            Used in the person panel, e.g. “Foster mother”. Leave the man and woman words empty to
            use the first word for everyone.
          </Hint>

          <LanguageWordFields
            register={register}
            errors={{ ms: errors.words?.ms?.label?.message, jv: errors.words?.jv?.label?.message }}
          />

          <div className="flex items-start gap-3">
            <Controller
              control={control}
              name="in_layout"
              render={({ field }) => (
                <Switch id="kind_layout" checked={field.value} onCheckedChange={field.onChange} />
              )}
            />
            <div className="space-y-0.5">
              <Label htmlFor="kind_layout">
                Place these children under this parent in the tree
              </Label>
              <Hint>
                Off: the child is shown under their birth parents only, with a dotted line to this
                parent.
              </Hint>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {kind ? "Save" : "Add kind"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
