import { clsx } from "clsx";
import React from "react";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx("rounded-lg border border-line bg-panel p-5 shadow-sm", className)}
      {...props}
    />
  );
}
