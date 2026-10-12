"use client";

/**
 * Form helpers (react-hook-form + zod).
 *
 *   const schema = z.object({ email: z.string().email() });
 *   const form = useZodForm(schema, { defaultValues: { email: "" } });
 *   <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
 *     <TextField form={form} name="email" label="Email" type="email" />
 *   </form>
 *
 * `applyApiErrors(form, err)` maps a 422 response's field errors onto the form and returns
 * whatever message is left over for a form-level <Alert>.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, Input, Textarea, type InputProps } from "@praxis/ui";
import * as React from "react";
import { useForm, type FieldValues, type Path, type UseFormProps, type UseFormReturn } from "react-hook-form";
import type { z } from "zod";
import { ApiError, errorMessage } from "@/lib/api";

export function useZodForm<S extends z.ZodTypeAny>(schema: S, props?: Omit<UseFormProps<z.input<S>>, "resolver">) {
  return useForm<z.input<S>, unknown, z.output<S>>({ resolver: zodResolver(schema), mode: "onTouched", ...props });
}

export function applyApiErrors<T extends FieldValues>(form: UseFormReturn<T, unknown, unknown>, err: unknown): string | null {
  if (err instanceof ApiError && err.isValidation) {
    const fields = err.fieldErrors();
    const names = Object.keys(form.getValues() ?? {});
    let mapped = 0;
    for (const [k, msg] of Object.entries(fields)) {
      if (names.includes(k)) {
        form.setError(k as Path<T>, { type: "server", message: msg });
        mapped++;
      }
    }
    if (mapped > 0) return null;
  }
  return errorMessage(err);
}

type FieldProps<T extends FieldValues> = {
  form: UseFormReturn<T, unknown, unknown>;
  name: Path<T>;
  label?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  labelAction?: React.ReactNode;
};

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  className,
  labelAction,
  ...input
}: FieldProps<T> & Omit<InputProps, "name" | "form">) {
  const error = form.formState.errors[name]?.message as string | undefined;
  return (
    <FormField label={label} hint={hint} error={error} required={required} className={className} labelAction={labelAction}>
      <Input {...input} {...form.register(name)} />
    </FormField>
  );
}

export function TextAreaField<T extends FieldValues>({
  form,
  name,
  label,
  hint,
  required,
  className,
  ...rest
}: FieldProps<T> & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name" | "form">) {
  const error = form.formState.errors[name]?.message as string | undefined;
  return (
    <FormField label={label} hint={hint} error={error} required={required} className={className}>
      <Textarea {...rest} {...form.register(name)} />
    </FormField>
  );
}
