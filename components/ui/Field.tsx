import { clsx } from "clsx";
import React, { useId } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

type FieldShellProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
};

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  return (
    <div className="grid gap-1.5">
      <label className="text-sm font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <span className="text-xs leading-5 text-muted" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="text-xs leading-5 text-red-600" id={`${id}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function getDescribedBy(id: string, describedBy: string | undefined, hint?: string, error?: string) {
  return [describedBy, hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined]
    .filter(Boolean)
    .join(" ") || undefined;
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function Field({
  label,
  hint,
  error,
  className,
  id,
  "aria-describedby": describedBy,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const fieldId = id || `${props.name || "field"}-${generatedId}`;

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <input
        aria-describedby={getDescribedBy(fieldId, describedBy, hint, error)}
        aria-invalid={error ? true : undefined}
        className={clsx(
          "min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-slate-400",
          "focus:border-brand focus:ring-2 focus:ring-blue-100",
          className
        )}
        id={fieldId}
        {...props}
      />
    </FieldShell>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({
  label,
  hint,
  error,
  className,
  id,
  "aria-describedby": describedBy,
  ...props
}: TextAreaFieldProps) {
  const generatedId = useId();
  const fieldId = id || `${props.name || "field"}-${generatedId}`;

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <textarea
        aria-describedby={getDescribedBy(fieldId, describedBy, hint, error)}
        aria-invalid={error ? true : undefined}
        className={clsx(
          "min-h-28 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition placeholder:text-slate-400",
          "focus:border-brand focus:ring-2 focus:ring-blue-100",
          className
        )}
        id={fieldId}
        {...props}
      />
    </FieldShell>
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
};

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  id,
  "aria-describedby": describedBy,
  ...props
}: SelectFieldProps) {
  const generatedId = useId();
  const fieldId = id || `${props.name || "field"}-${generatedId}`;

  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <select
        aria-describedby={getDescribedBy(fieldId, describedBy, hint, error)}
        aria-invalid={error ? true : undefined}
        className={clsx(
          "min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none transition",
          "focus:border-brand focus:ring-2 focus:ring-blue-100",
          className
        )}
        id={fieldId}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}
