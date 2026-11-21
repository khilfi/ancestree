import { zodResolver } from "@hookform/resolvers/zod";
import { BabyIcon, HouseIcon } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { Controller, type FieldPath, FormProvider, useForm, useFormContext } from "react-hook-form";
import { ApiError } from "@/api/errors";
import { useCreatePerson, usePeople, useUpdatePerson } from "@/api/queries";
import type { PersonDetail, PersonSaved } from "@/api/types";
import { Hint } from "@/components/Hint";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { GrowingText } from "@/components/ui/growing-text";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { offerTryAgain } from "@/lib/notify";
import { formatPlace } from "@/lib/people";
import { DatePicker } from "./DatePicker";
import { type Copy, type FormPlace, PlaceBlock, type PlaceKey } from "./PlaceBlock";
import {
  formValues,
  type PersonFormValues,
  personSchema,
  placeValues,
  toInput,
} from "./personSchema";
import { hasPlace, type Mixup, mixup, movedHome, placeLine } from "./places";
import { useDiscardGuard } from "./useDiscardGuard";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-faint uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const WHOSE = {
  mother: "their mother's",
  father: "their father's",
  parents: "their parents'",
} as const;

/** Where someone with no place of their own lives: at their parents', as long as
 *  they're not known to have died, until they're given a place or **Lives elsewhere** is
 *  ticked. When the parents live apart, the one they sit under on the tree laid out from the
 *  oldest ancestor, unless the other is chosen: the choice starts at that one. */
function LivesWith({ person }: { person: PersonDetail }) {
  const { control, watch } = useFormContext<PersonFormValues>();
  const home = watch("residence");
  const living = watch("living");
  const own = [home.address, home.town, home.district, home.state, home.postcode].some(Boolean);
  const dead = living === "deceased" || (living === "auto" && person.is_living === false);
  if (own || dead || person.parents.length === 0) return null;
  const at = person.residence_at_parents;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      <p className="text-muted-foreground">
        {at
          ? `With no place of their own, they're shown at ${WHOSE[at.whose]}: ${formatPlace(at.place, at.district)}.`
          : "With no place of their own, they're shown at their parents', once a parent has one."}
      </p>
      <Controller
        control={control}
        name="lives_with"
        render={({ field }) =>
          person.parents_apart ? (
            <RadioGroup
              value={field.value || (at?.whose === "father" ? "father" : "mother")}
              onValueChange={field.onChange}
              aria-label="Where they live, with no place of their own"
              className="gap-1.5"
            >
              {(
                [
                  ["mother", "At their mother's"],
                  ["father", "At their father's"],
                  ["elsewhere", "Lives elsewhere"],
                ] as const
              ).map(([value, words]) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem value={value} id={`lives-with-${value}`} />
                  <Label htmlFor={`lives-with-${value}`} className="font-normal">
                    {words}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <div className="flex items-center gap-2">
              <Checkbox
                id="lives-elsewhere"
                checked={field.value === "elsewhere"}
                onCheckedChange={(on) => field.onChange(on === true ? "elsewhere" : "")}
              />
              <Label htmlFor="lives-elsewhere" className="font-normal">
                Lives elsewhere
              </Label>
            </div>
          )
        }
      />
    </div>
  );
}

const THIS_YEAR = new Date().getFullYear();

/** Whether someone is living, as the form says it now: so set, or worked out from the
 *  dates, as the engine works it out: no death recorded, and born within 110 years (or, for
 *  someone saved already, as the engine last worked it out). */
function livingNow(values: PersonFormValues, person?: PersonDetail): boolean {
  if (values.living !== "auto") return values.living === "living";
  if (values.death_date.year != null) return false;
  if (person) return person.is_living === true;
  const year = values.birth_date.year;
  return year != null && THIS_YEAR - year <= 110;
}

/** Their parents' places, to fill one of theirs in from: "Same as their parents'" where
 *  the parents live at one place, else one for each parent, as your answer of 14 Oct 2026. */
function parentsCopies(parents: PersonDetail[]): Copy[] {
  const homes = parents.filter((parent) => hasPlace(parent.residence));
  const [first] = homes;
  if (!first) return [];
  const lines = new Set(homes.map((parent) => placeLine(parent.residence)));
  if (lines.size === 1) {
    return [{ label: "Same as their parents'", place: placeValues(first.residence) }];
  }
  return homes.map((parent) => ({
    label:
      parent.gender === "female"
        ? "Same as their mother's"
        : parent.gender === "male"
          ? "Same as their father's"
          : `Same as ${parent.full_name}'s`,
    place: placeValues(parent.residence),
  }));
}

/** Create or edit someone. Only the full name is required. */
export function PersonForm({
  person,
  onSaved,
  onCancel,
}: {
  person?: PersonDetail;
  onSaved: (saved: PersonSaved) => void;
  onCancel: () => void;
}) {
  const form = useForm<PersonFormValues>({
    resolver: zodResolver(personSchema),
    defaultValues: formValues(person),
  });
  const { register, control, formState, watch, setValue } = form;
  const { errors, isDirty } = formState; // read while rendering, so the form keeps them current
  const create = useCreatePerson();
  const update = useUpdatePerson(person?.id ?? "");
  const saving = create.isPending || update.isPending;
  const done = useRef(false);
  // One place open at a time; each folded to a line until then.
  const [opened, setOpened] = useState<PlaceKey | null>(null);
  const toggle = (key: PlaceKey) => setOpened((now) => (now === key ? null : key));
  // A mix-up of places, asked about before saving.
  const [asking, setAsking] = useState<{ values: PersonFormValues; wrong: Mixup } | null>(null);
  const parentDetails = usePeople(person?.parents.map((parent) => parent.id) ?? []);
  const parents = parentDetails.flatMap((query) => (query.data ? [query.data] : []));

  const [residence, birthPlace, deathPlace] = watch(["residence", "birth_place", "death_place"]);
  const [living, deathDate, burial] = watch(["living", "death_date", "burial_place"]);
  const fromParents = parentsCopies(parents);
  const copy = (label: string, place: FormPlace): Copy[] =>
    hasPlace(place) ? [{ label, place }] : [];
  // The death part, only when needed: for someone who has died, or where something of it
  // is filled in already, which is kept as it is, with a word if they're marked living.
  // A death date being typed counts as one, so the part stays open while it's typed.
  const deathDated = deathDate.year != null || Boolean(deathDate.typed?.trim());
  const dead =
    living === "deceased" || (living === "auto" && (person?.is_living === false || deathDated));
  const deathGiven = deathDated || hasPlace(deathPlace) || burial.trim() !== "";

  // Cancel, Esc and leaving a half-edited form ask first: inside the app, and when
  // closing the tab.
  const discard = useDiscardGuard(() => isDirty && !done.current, onCancel);

  const save = async (values: PersonFormValues) => {
    try {
      const input = toInput(values);
      const saved = person ? await update.mutateAsync(input) : await create.mutateAsync(input);
      done.current = true;
      onSaved(saved);
    } catch (error) {
      const fields = error instanceof ApiError ? Object.entries(error.fieldErrors) : [];
      if (fields.length === 0) offerTryAgain(error, () => void save(values));
      for (const [field, message] of fields) {
        form.setError(field as FieldPath<PersonFormValues>, { message });
      }
    }
  };
  const submit = form.handleSubmit(async (values) => {
    const wrong = mixup(values, livingNow(values, person));
    if (wrong) setAsking({ values, wrong });
    else await save(values);
  });
  // Moved, as asked (your answer of 14 Oct 2026): the address and its pin to where they live,
  // the birthplace keeping its town, a living person's place of death cleared. Then saved.
  const moveHome = async () => {
    if (!asking) return;
    const moved = movedHome(asking.values, asking.wrong, placeValues(null));
    for (const key of ["residence", "birth_place", "death_place"] as const) {
      setValue(key, moved[key], { shouldDirty: true });
    }
    setAsking(null);
    await save({ ...asking.values, ...moved });
  };

  // Ctrl+Enter saves from anywhere in the form, a box of notes too.
  const saveByKey = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || saving) return;
    event.preventDefault();
    void submit();
  };

  return (
    <FormProvider {...form}>
      {/* The fields scroll, with Save and Cancel kept in view at the foot, and a field
          the keyboard reaches scrolled clear of them. */}
      <form
        onSubmit={submit}
        onKeyDown={saveByKey}
        className="min-h-0 flex-1 scroll-pb-20 space-y-6 overflow-y-auto px-4 pt-2"
        noValidate
      >
        <Section title="Name">
          <Field id="full_name" label="Full name" error={errors.full_name?.message}>
            <GrowingText
              id="full_name"
              placeholder="e.g. Hassan bin Ismail"
              autoFocus={!person}
              {...register("full_name")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="nickname" label="Nickname">
              <GrowingText id="nickname" placeholder="e.g. Pak Mat" {...register("nickname")} />
            </Field>
            <Field id="title" label="Title">
              <GrowingText id="title" placeholder="e.g. Haji, Dato'" {...register("title")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id="gender" label="Gender">
              <Controller
                control={control}
                name="gender"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="gender" className="w-full">
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
            {/* By the name: choosing Deceased opens the death part below. */}
            <Field id="living" label="Living or deceased">
              <Controller
                control={control}
                name="living"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="living" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Work it out from the dates</SelectItem>
                      <SelectItem value="living">Living</SelectItem>
                      <SelectItem value="deceased">Deceased</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          <Field id="name_jawi" label="Name in Jawi">
            <GrowingText id="name_jawi" dir="rtl" lang="ms-Arab" {...register("name_jawi")} />
          </Field>
        </Section>

        {/* Where they live first: the place the map shows. */}
        <Section title="Now">
          <PlaceBlock
            name="residence"
            title="Where they live now"
            sign={HouseIcon}
            open={opened === "residence"}
            onOpen={() => toggle("residence")}
            copies={[...copy("Same as where they were born", birthPlace), ...fromParents]}
          />
          {person && <LivesWith person={person} />}
          <Field id="occupation" label="Occupation">
            <GrowingText id="occupation" {...register("occupation")} />
          </Field>
        </Section>

        <Section title="Birth">
          <Field id="birth_date" label="Date">
            <Controller
              control={control}
              name="birth_date"
              render={({ field }) => (
                <DatePicker
                  id="birth_date"
                  label="Date of birth"
                  value={field.value}
                  onChange={field.onChange}
                  error={errors.birth_date?.message}
                />
              )}
            />
          </Field>
          <PlaceBlock
            name="birth_place"
            title="Where they were born"
            sign={BabyIcon}
            open={opened === "birth_place"}
            onOpen={() => toggle("birth_place")}
            copies={[...copy("Same as where they live", residence), ...fromParents]}
          />
        </Section>

        {(dead || deathGiven) && (
          <Section title="Death">
            {!dead && (
              <p className="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning-soft-foreground">
                They're marked as living, yet something of their death is filled in. Choose Deceased
                beside their name, or clear it.
              </p>
            )}
            <Field id="death_date" label="Date">
              <Controller
                control={control}
                name="death_date"
                render={({ field }) => (
                  <DatePicker
                    id="death_date"
                    label="Date of death"
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.death_date?.message}
                  />
                )}
              />
            </Field>
            {/* "Buried at", as their details say it. */}
            <Field id="burial_place" label="Buried at">
              <GrowingText
                id="burial_place"
                placeholder="e.g. Tanah Perkuburan Islam Kg. Baru"
                {...register("burial_place")}
              />
            </Field>
          </Section>
        )}

        <Section title="Notes">
          <Field id="notes" label="Short notes" error={errors.notes?.message}>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </Field>
        </Section>

        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-card px-4 py-3">
          <Hint label={person ? "Save (Ctrl+Enter)" : "Add person (Ctrl+Enter)"} side="top">
            <Button type="submit" disabled={saving}>
              {person ? "Save" : "Add person"}
            </Button>
          </Hint>
          <Button type="button" variant="ghost" onClick={discard.cancel}>
            Cancel
          </Button>
        </div>
      </form>

      {/* A mix-up of places, asked about before it's saved. */}
      <AlertDialog open={asking !== null} onOpenChange={(open) => !open && setAsking(null)}>
        {/* Wider than most, for its three answers side by side. */}
        <AlertDialogContent className="data-[size=default]:sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Is that where they live?</AlertDialogTitle>
            <AlertDialogDescription>
              {asking?.wrong.death &&
                `They're living, yet have a place of death: ${placeLine(asking.values.death_place)}. `}
              {asking?.wrong.birth &&
                `Where they were born has an address, ${placeLine(asking.values.birth_place)}, and where they live has none.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAsking(null)}>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const values = asking?.values;
                setAsking(null);
                if (values) void save(values);
              }}
            >
              Save as it is
            </Button>
            <AlertDialogAction onClick={() => void moveHome()}>
              {asking?.wrong.home ? "Move it to Where they live" : "Clear the place of death"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {discard.question}
    </FormProvider>
  );
}
