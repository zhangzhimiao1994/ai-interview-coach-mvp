"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

type SaveState = "idle" | "saving" | "saved" | "error";

export function CandidateForm() {
  const router = useRouter();
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setState("saving");
    setMessage("");

    try {
      const form = new FormData(formElement);
      const response = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          phone: form.get("phone"),
          targetCompany: form.get("targetCompany"),
          targetRole: form.get("targetRole")
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setState("error");
        setMessage(payload?.error || "无法创建求职者。");
        return;
      }

      setState("saved");
      setMessage("求职者已创建。");
      formElement.reset();
      router.refresh();
    } catch {
      setState("error");
      setMessage("无法连接服务器，请检查网络后重试。");
    } finally {
      setState((current) => (current === "saving" ? "idle" : current));
    }
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <Field label="姓名" name="name" required autoComplete="name" />
      <Field label="邮箱" name="email" type="email" autoComplete="email" />
      <Field label="手机号" name="phone" autoComplete="tel" />
      <Field label="目标公司" name="targetCompany" />
      <Field label="目标岗位" name="targetRole" />
      {message ? (
        <p className={state === "error" ? "text-sm text-red-600" : "text-sm text-accent"} aria-live="polite">
          {message}
        </p>
      ) : null}
      <Button disabled={state === "saving"} type="submit">
        {state === "saving" ? "创建中..." : "创建求职者"}
      </Button>
    </form>
  );
}
