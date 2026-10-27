import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "./auth-context";

interface FormErrors {
  email?: string;
  displayName?: string;
  password?: string;
}

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const registering = mode === "register";
  const { user, loading: checkingSession, login, register, sessionError } =
    useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (checkingSession) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;

  function validate(): FormErrors {
    const nextErrors: FormErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = "Enter a valid email address.";
    }
    if (registering && displayName.trim().length < 2) {
      nextErrors.displayName = "Name must be at least 2 characters.";
    }
    if (registering && password.length < 12) {
      nextErrors.password = "Use at least 12 characters for your password.";
    } else if (password.length === 0) {
      nextErrors.password = "Enter your password.";
    } else if (new TextEncoder().encode(password).length > 72) {
      nextErrors.password = "Password must be no more than 72 UTF-8 bytes.";
    }
    return nextErrors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      if (registering) {
        await register(email.trim(), displayName.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      navigate("/", { replace: true });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7fb] px-4 py-10 sm:px-6">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 lg:min-h-[620px] lg:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-indigo-700 p-10 text-white lg:flex">
          <div className="absolute -right-24 -top-20 size-80 rounded-full border border-white/10" />
          <div className="absolute -right-10 -top-6 size-52 rounded-full border border-white/10" />
          <Link to="/" className="relative flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-white text-lg font-bold text-indigo-700">
              t
            </span>
            <span className="text-sm font-bold tracking-tight">taskboard</span>
          </Link>
          <div className="relative max-w-sm">
            <p className="mb-4 text-xs font-semibold tracking-[0.18em] text-indigo-200">
              MAKE ROOM FOR GOOD WORK
            </p>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight">
              A clearer way to move work forward.
            </h1>
            <p className="mt-5 text-sm leading-7 text-indigo-100">
              Keep your team in sync, your priorities visible, and your next
              steps within reach.
            </p>
          </div>
          <p className="relative text-xs text-indigo-200">
            A calm space for ambitious teams.
          </p>
        </aside>

        <section className="flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
          <Link
            to="/"
            className="mb-10 flex items-center gap-3 text-slate-900 lg:hidden"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
              t
            </span>
            <span className="text-sm font-bold tracking-tight">taskboard</span>
          </Link>
          <div className="mx-auto w-full max-w-md">
            <p className="text-sm font-semibold text-indigo-600">
              {registering ? "GET STARTED" : "WELCOME BACK"}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              {registering ? "Create your account" : "Sign in to Taskboard"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {registering
                ? "Set up your account to start organizing your team's work."
                : "Pick up where you and your team left off."}
            </p>

            {sessionError && (
              <p
                role="status"
                className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
              >
                Session check: {sessionError}
              </p>
            )}
            {formError && (
              <p
                role="alert"
                className="mt-5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
              >
                {formError}
              </p>
            )}

            <form className="mt-7 space-y-5" onSubmit={handleSubmit} noValidate>
              {registering && (
                <Field
                  label="Your name"
                  error={errors.displayName}
                  id="displayName"
                >
                  <input
                    autoComplete="name"
                    id="displayName"
                    maxLength={60}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    aria-invalid={Boolean(errors.displayName)}
                    aria-describedby={
                      errors.displayName ? "displayName-error" : undefined
                    }
                    className={inputClass}
                    placeholder="Asha Rao"
                  />
                </Field>
              )}
              <Field label="Email address" error={errors.email} id="email">
                <input
                  autoComplete="email"
                  id="email"
                  type="email"
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "email-error" : undefined}
                  className={inputClass}
                  placeholder="you@company.com"
                />
              </Field>
              <Field label="Password" error={errors.password} id="password">
                <input
                  autoComplete={registering ? "new-password" : "current-password"}
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "password-error" : undefined
                  }
                  className={inputClass}
                  placeholder={
                    registering ? "At least 12 characters" : "Your password"
                  }
                />
              </Field>
              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting
                  ? registering
                    ? "Creating account…"
                    : "Signing in…"
                  : registering
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>

            <p className="mt-7 text-center text-sm text-slate-500">
              {registering ? "Already have an account?" : "New to Taskboard?"}{" "}
              <Link
                to={registering ? "/login" : "/register"}
                className="font-semibold text-indigo-600 hover:text-indigo-700"
              >
                {registering ? "Sign in" : "Create an account"}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

const inputClass =
  "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100 aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus:ring-rose-100";

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
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function LoadingScreen() {
  return (
    <div
      role="status"
      className="grid min-h-screen place-items-center bg-[#f6f7fb] text-sm text-slate-500"
    >
      Checking your workspace…
    </div>
  );
}
