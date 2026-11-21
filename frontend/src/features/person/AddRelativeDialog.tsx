import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { ApiError, inWords } from "@/api/errors";
import { useAddRelative, useLink, useSearchPeople } from "@/api/queries";
import type { PersonDetail, PersonSummary, Relation, SpouseStatus } from "@/api/types";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GrowingText } from "@/components/ui/growing-text";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { showError } from "@/lib/notify";
import { lifeYears } from "@/lib/people";
import { z } from "@/lib/schema";
import { useDebounced } from "@/lib/useDebounced";
import { DatePicker, dateInput, datePartsSchema, NO_DATE } from "./DatePicker";
import { KindSelect } from "./KindSelect";
import { useDialogDiscard } from "./useDiscardGuard";
import { useFeedback } from "./useFeedback";

const NONE = "__none__"; // Select items can't have an empty value

const WHO: Record<Relation, string> = {
  parent: "a parent",
  spouse: "a husband or wife",
  child: "a child",
  sibling: "a brother or sister",
};

const HELP: Record<Relation, string> = {
  parent: "A father or mother, by birth or otherwise.",
  spouse: "A husband or wife, current or former.",
  child: "A son or daughter, by birth or otherwise.",
  sibling:
    "They'll share the parents already recorded. If none are, an unknown parent joins them for now.",
};

/** Everyone this person has had children with, or married: the choices for "other parent". */
function coParents(person: PersonDetail): PersonSummary[] {
  const found = new Map<string, PersonSummary>();
  for (const spouse of person.spouses) found.set(spouse.id, spouse);
  for (const group of person.child_groups) {
    for (const other of group.other_parents) if (!other.placeholder) found.set(other.id, other);
  }
  return [...found.values()];
}

function likelyOtherParent(person: PersonDetail): string {
  const current = person.spouses.filter((spouse) => spouse.status !== "divorced");
  if (current.length === 1) return current[0]?.id ?? NONE;
  return person.spouses.length === 1 ? (person.spouses[0]?.id ?? NONE) : NONE;
}

function Field({ id, label, children }: { id?: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function OtherParentSelect({
  person,
  value,
  onChange,
}: {
  person: PersonDetail;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id="other_parent" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {coParents(person).map((other) => (
          <SelectItem key={other.id} value={other.id}>
            {other.full_name}
          </SelectItem>
        ))}
        <SelectItem value={NONE}>Not recorded</SelectItem>
      </SelectContent>
    </Select>
  );
}

type Props = {
  person: PersonDetail;
  relation: Relation;
  onClose: () => void;
  onOpenPerson: (id: string) => void;
};

/** Each tab's own: Cancel, and whether anything has been typed in it yet. */
type Asking = { onCancel: () => void; onTyped: (typed: boolean) => void };

/**
 * Add a relative: someone new, created already linked, or someone already in the tree. What's
 * typed isn't thrown away without the person form's question: Cancel, Esc and × ask
 * "Discard your changes?" first once anything is typed in the tab shown, and close at once when
 * nothing is.
 */
export function AddRelativeDialog({ person, relation, onClose, onOpenPerson }: Props) {
  const [typed, setTyped] = useState(false);
  const discard = useDialogDiscard(() => typed, onClose);
  const asking: Asking = { onCancel: discard.cancel, onTyped: setTyped };
  return (
    <Dialog open onOpenChange={(open) => !open && discard.cancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add {WHO[relation]} of {person.nickname || person.full_name}
          </DialogTitle>
          <DialogDescription>{HELP[relation]}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="new">
          <TabsList className="w-full">
            <TabsTrigger value="new">Someone new</TabsTrigger>
            <TabsTrigger value="existing">Already in the tree</TabsTrigger>
          </TabsList>
          <TabsContent value="new" className="pt-2">
            <NewRelative
              person={person}
              relation={relation}
              onClose={onClose}
              onOpenPerson={onOpenPerson}
              {...asking}
            />
          </TabsContent>
          <TabsContent value="existing" className="pt-2">
            <ExistingRelative
              person={person}
              relation={relation}
              onClose={onClose}
              onOpenPerson={onOpenPerson}
              {...asking}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
      {discard.question}
    </Dialog>
  );
}

/** Says whether anything is typed in a tab, as it changes, and nothing once it's gone. */
function useTyped(typed: boolean, onTyped: (typed: boolean) => void): void {
  useEffect(() => onTyped(typed), [typed, onTyped]);
  useEffect(() => () => onTyped(false), [onTyped]);
}

const newSchema = z.object({
  full_name: z.string().trim().min(1, "A name is needed."),
  gender: z.enum(["male", "female", "unknown"]),
  birth_date: datePartsSchema,
  kind: z.string(),
  other_parent: z.string(),
});
type NewValues = z.infer<typeof newSchema>;

const OPPOSITE = { male: "female", female: "male", unknown: "unknown" } as const;

function NewRelative({
  person,
  relation,
  onClose,
  onOpenPerson,
  onCancel,
  onTyped,
}: Props & Asking) {
  const add = useAddRelative(person.id);
  const feedback = useFeedback();
  const form = useForm<NewValues>({
    resolver: zodResolver(newSchema),
    defaultValues: {
      full_name: "",
      gender: relation === "spouse" ? OPPOSITE[person.gender] : "unknown",
      birth_date: NO_DATE,
      kind: "biological",
      other_parent: likelyOtherParent(person),
    },
  });
  const { register, control, formState } = form;
  const { errors, isDirty } = formState;
  // Typed into, or not: the form emptied by Add and add another is as it was.
  useTyped(isDirty, onTyped);
  // Add and add another: the form empties for the next, and stays open, the name ready.
  const another = useRef(false);
  const { ref: nameRef, ...nameField } = register("full_name");
  const nameBox = useRef<HTMLTextAreaElement | null>(null);
  const [next, setNext] = useState(0); // how many added so far, one after another
  useEffect(() => {
    if (next > 0) nameBox.current?.focus();
  }, [next]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const added = await add.mutateAsync({
        relation,
        person: {
          full_name: values.full_name,
          gender: values.gender,
          birth_date: dateInput(values.birth_date),
        },
        kind: values.kind,
        other_parent:
          relation === "child" && values.other_parent !== NONE ? values.other_parent : null,
      });
      feedback(`Added ${added.person.full_name}.`, added, {
        action: { label: "Open", onClick: () => onOpenPerson(added.person.id) },
      });
      if (!another.current) {
        onClose();
        return;
      }
      // The next: a father's often followed by a mother, and the children by the same other
      // parent, of the same kind.
      form.reset({
        full_name: "",
        gender:
          relation === "spouse"
            ? OPPOSITE[person.gender]
            : relation === "parent"
              ? OPPOSITE[values.gender]
              : "unknown",
        birth_date: NO_DATE,
        kind: values.kind,
        other_parent: values.other_parent,
      });
      setNext((count) => count + 1);
    } catch (error) {
      const fields = error instanceof ApiError ? Object.entries(error.fieldErrors) : [];
      const own = fields.filter(
        ([path]) => path === "person.full_name" || path === "person.birth_date",
      );
      if (own.length === 0) showError(error);
      for (const [path, message] of own) {
        form.setError(path === "person.full_name" ? "full_name" : "birth_date", { message });
      }
    }
  });

  return (
    <form
      onSubmit={(event) => {
        another.current = false; // Enter, or Add
        void submit(event);
      }}
      className="space-y-4"
      noValidate
    >
      <Field id="relative_name" label="Full name">
        <GrowingText
          id="relative_name"
          autoFocus
          ref={(element) => {
            nameRef(element);
            nameBox.current = element;
          }}
          {...nameField}
        />
        {errors.full_name && <p className="text-xs text-destructive">{errors.full_name.message}</p>}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="relative_gender" label="Gender">
          <Controller
            control={control}
            name="gender"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="relative_gender" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </Field>
        {(relation === "parent" || relation === "child") && (
          <Field id="relative_kind" label="Kind">
            <Controller
              control={control}
              name="kind"
              render={({ field }) => (
                <KindSelect id="relative_kind" value={field.value} onChange={field.onChange} />
              )}
            />
          </Field>
        )}
      </div>
      <Field id="relative_born" label="Born">
        <Controller
          control={control}
          name="birth_date"
          render={({ field }) => (
            <DatePicker
              id="relative_born"
              label="Date of birth"
              value={field.value}
              onChange={field.onChange}
              error={errors.birth_date?.message}
            />
          )}
        />
      </Field>
      {relation === "child" && (
        <Field id="other_parent" label="Other parent">
          <Controller
            control={control}
            name="other_parent"
            render={({ field }) => (
              <OtherParentSelect person={person} value={field.value} onChange={field.onChange} />
            )}
          />
        </Field>
      )}
      <p className="text-xs text-faint">Everything else can be filled in later.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {/* Not a submit button, so Enter is still Add. */}
        <Button
          type="button"
          variant="outline"
          disabled={add.isPending}
          onClick={() => {
            another.current = true;
            void submit();
          }}
        >
          Add and add another
        </Button>
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
      </div>
    </form>
  );
}

type Candidate = { id: string; full_name: string; parent_of: string };

function ExistingRelative({ person, relation, onClose, onCancel, onTyped }: Props & Asking) {
  const [text, setText] = useState("");
  const results = useSearchPeople(useDebounced(text.trim(), 200));
  const [chosen, setChosen] = useState<PersonSummary | null>(null);
  const [kind, setKind] = useState("biological");
  const [status, setStatus] = useState<SpouseStatus>("married");
  const [otherParent, setOtherParent] = useState(likelyOtherParent(person));
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [shared, setShared] = useState<string[]>([]);
  const link = useLink();
  const feedback = useFeedback();
  const people = (results.data ?? []).filter((found) => found.id !== person.id);
  // Someone chosen is a link begun; words in the search alone are a search.
  useTyped(chosen !== null, onTyped);

  function choose(next: PersonSummary | null) {
    setChosen(next);
    setCandidates(null);
    setShared([]);
  }

  async function submit() {
    if (!chosen) return;
    try {
      const result = await link.mutateAsync({
        person_a: chosen.id,
        person_b: person.id,
        a_is: relation,
        kind,
        status,
        shared_parents: candidates ? shared : null,
      });
      // Both links in one note, what went wrong with the second too.
      const said = [result];
      const warnings: string[] = [];
      if (relation === "child" && otherParent !== NONE && otherParent !== chosen.id) {
        try {
          said.push(
            await link.mutateAsync({
              person_a: chosen.id,
              person_b: otherParent,
              a_is: "child",
              kind,
              status: "married",
            }),
          );
        } catch (error) {
          if (!(error instanceof ApiError && error.code === "already_linked")) {
            warnings.push(inWords(error));
          }
        }
      }
      feedback(`Linked ${chosen.full_name}.`, said, { warnings });
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === "choose_shared_parents") {
        const found = (error.detail as { candidates?: Candidate[] }).candidates ?? [];
        setCandidates(found);
        // When only one of them has parents recorded, those are the likely shared ones.
        const sides = new Set(found.map((candidate) => candidate.parent_of));
        setShared(sides.size === 1 ? found.map((candidate) => candidate.id) : []);
        return;
      }
      showError(error);
    }
  }

  if (!chosen) {
    return (
      <Command shouldFilter={false} className="rounded-lg border">
        <CommandInput
          placeholder="Search by name or nickname…"
          value={text}
          onValueChange={setText}
        />
        <CommandList>
          <CommandEmpty>{results.isFetching ? "Searching…" : "No one found."}</CommandEmpty>
          {people.map((found) => (
            <CommandItem key={found.id} value={found.id} onSelect={() => choose(found)}>
              <PersonAvatar person={found} size="sm" />
              <span className="min-w-0 flex-1 truncate">{found.full_name}</span>
              <span className="text-xs text-faint">{lifeYears(found)}</span>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    );
  }

  const nameOf = (id: string) => (id === person.id ? person.full_name : chosen.full_name);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border p-2">
        <PersonAvatar person={chosen} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{chosen.full_name}</div>
          <div className="text-xs text-faint">{lifeYears(chosen)}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => choose(null)}>
          Change
        </Button>
      </div>

      {(relation === "parent" || relation === "child") && (
        <Field id="link_kind" label="Kind">
          <KindSelect id="link_kind" value={kind} onChange={setKind} />
        </Field>
      )}
      {relation === "spouse" && (
        <Field id="link_status" label="Marriage">
          <Select value={status} onValueChange={(value) => setStatus(value as SpouseStatus)}>
            <SelectTrigger id="link_status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="married">Married</SelectItem>
              <SelectItem value="divorced">Divorced</SelectItem>
              <SelectItem value="widowed">Widowed</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      )}
      {relation === "child" && (
        <Field id="other_parent" label="Other parent">
          <OtherParentSelect person={person} value={otherParent} onChange={setOtherParent} />
        </Field>
      )}
      {candidates && (
        <fieldset className="space-y-2 rounded-lg border border-warning-border bg-warning-soft p-3">
          <legend className="px-1 text-sm font-medium">Which parents do they share?</legend>
          {candidates.map((candidate) => (
            <div key={candidate.id} className="flex items-center gap-2">
              <Checkbox
                id={`shared-${candidate.id}`}
                checked={shared.includes(candidate.id)}
                onCheckedChange={(checked) =>
                  setShared((current) =>
                    checked
                      ? [...current, candidate.id]
                      : current.filter((id) => id !== candidate.id),
                  )
                }
              />
              <Label htmlFor={`shared-${candidate.id}`} className="font-normal">
                {candidate.full_name}
                <span className="text-faint">· parent of {nameOf(candidate.parent_of)}</span>
              </Label>
            </div>
          ))}
        </fieldset>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={link.isPending || (candidates !== null && !shared.length)}
        >
          Link
        </Button>
      </div>
    </div>
  );
}
