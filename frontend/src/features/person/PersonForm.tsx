import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useEffect, useRef } from "react";
import { Controller, type FieldPath, FormProvider, useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { showError } from "@/lib/notify";
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
            <Input
              id="full_name"
              placeholder="e.g. Hassan bin Ismail"
              autoFocus={!person}
              {...register("full_name")}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="nickname" label="Nickname">
              <Input id="nickname" placeholder="e.g. Pak Mat" {...register("nickname")} />
            </Field>
            <Field id="title" label="Title">
              <Input id="title" placeholder="e.g. Haji, Dato'" {...register("title")} />
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
              <Input id="name_jawi" dir="rtl" lang="ms-Arab" {...register("name_jawi")} />
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
            <Input
              id="burial_place"
              placeholder="e.g. Tanah Perkuburan Islam Kg. Baru"
              {...register("burial_place")}
            />
          </Field>
        </Section>

        <Section title="Now">
          <PlaceFields name="residence" label="Lives in" />
          <Field id="occupation" label="Occupation">
            <Input id="occupation" {...register("occupation")} />
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
