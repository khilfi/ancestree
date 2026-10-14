import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect, useRef } from "react";
import { Controller, type FieldPath, FormProvider, useForm, useFormContext } from "react-hook-form";
import { useBlocker } from "react-router";
import { ApiError } from "@/api/errors";
import { useCreatePerson, useUpdatePerson } from "@/api/queries";
import type { PersonDetail, PersonSaved } from "@/api/types";
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
import { showError } from "@/lib/notify";
import { formatPlace } from "@/lib/people";
import { DatePicker } from "./DatePicker";
import { PlaceFields } from "./PlaceFields";
import { formValues, type PersonFormValues, personSchema, toInput } from "./personSchema";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{title}</h3>
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
      {error && <p className="text-xs text-red-600">{error}</p>}
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
 *  ticked. When the parents live apart, their mother's, unless their father's is chosen. */
function LivesWith({ person }: { person: PersonDetail }) {
  const { control, watch } = useFormContext<PersonFormValues>();
  const home = watch("residence");
  const living = watch("living");
  const own = [home.address, home.town, home.district, home.state, home.postcode].some(Boolean);
  const dead = living === "deceased" || (living === "auto" && person.is_living === false);
  if (own || dead || person.parents.length === 0) return null;
  const at = person.residence_at_parents;
  return (
    <div className="space-y-2 rounded-lg border border-stone-200 p-3 text-sm">
      <p className="text-stone-600">
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
              value={field.value || "mother"}
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
  const { register, control, formState } = form;
  const { errors, isDirty } = formState; // read while rendering, so the form keeps them current
  const create = useCreatePerson();
  const update = useUpdatePerson(person?.id ?? "");
  const saving = create.isPending || update.isPending;
  const done = useRef(false);

  // Leaving a half-edited form asks first: inside the app, and when closing the tab.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      !done.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const input = toInput(values);
      const saved = person ? await update.mutateAsync(input) : await create.mutateAsync(input);
      done.current = true;
      onSaved(saved);
    } catch (error) {
      const fields = error instanceof ApiError ? Object.entries(error.fieldErrors) : [];
      if (fields.length === 0) showError(error);
      for (const [field, message] of fields) {
        form.setError(field as FieldPath<PersonFormValues>, { message });
      }
    }
  });

  return (
    <FormProvider {...form}>
      <form onSubmit={submit} className="space-y-6" noValidate>
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
            <Field id="name_jawi" label="Name in Jawi">
              <GrowingText id="name_jawi" dir="rtl" lang="ms-Arab" {...register("name_jawi")} />
            </Field>
          </div>
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
          <PlaceFields name="birth_place" label="Place of birth" />
        </Section>

        <Section title="Death">
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
          <PlaceFields name="death_place" label="Place of death" />
          <Field id="burial_place" label="Buried at">
            <GrowingText
              id="burial_place"
              placeholder="e.g. Tanah Perkuburan Islam Kg. Baru"
              {...register("burial_place")}
            />
          </Field>
        </Section>

        <Section title="Now">
          <PlaceFields name="residence" label="Lives in" />
          {person && <LivesWith person={person} />}
          <Field id="occupation" label="Occupation">
            <GrowingText id="occupation" {...register("occupation")} />
          </Field>
        </Section>

        <Section title="Notes">
          <Field id="notes" label="Short notes" error={errors.notes?.message}>
            <Textarea id="notes" rows={3} {...register("notes")} />
          </Field>
        </Section>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {person ? "Save" : "Add person"}
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>

      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You've changed this form but haven't saved it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormProvider>
  );
}
