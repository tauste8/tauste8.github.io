import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Logo } from "../components/Layout";
import { Alert, Button, ErrorBox, Field } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle: string }) {
  return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="row" style={{ marginBottom: 22 }}>
          <Logo size={42} />
          <div>
            <div className="brand-name" style={{ fontSize: 19 }}>AUTORECA <span style={{ color: "var(--lime)" }}>IA</span></div>
            <div className="small muted">{subtitle}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { refresh, mailConfigured } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [forgot, setForgot] = useState(false);
  const [msg, setMsg] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (forgot) {
        const r = await api.post<{ message: string }>("/auth/forgot", { email });
        setMsg(r.message);
      } else {
        await api.post("/auth/login", { email, password });
        await refresh();
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell subtitle={forgot ? "Recuperar contraseña" : "Acceso para el equipo"}>
      <form className="stack" onSubmit={submit}>
        <Field label="Correo electrónico">
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {!forgot && (
          <Field label="Contraseña">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        <ErrorBox error={err} />
        {msg && <Alert tone={mailConfigured ? "lime" : "amber"}>{msg}</Alert>}
        <Button type="submit" variant="primary" loading={busy} icon={forgot ? <KeyRound size={16} /> : <LogIn size={16} />}>
          {forgot ? "Enviar enlace" : "Iniciar sesión"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { setForgot(!forgot); setErr(null); setMsg(""); }}>
          {forgot ? "Volver a iniciar sesión" : "He olvidado mi contraseña"}
        </Button>
      </form>
    </Shell>
  );
}

export function SetupPage() {
  const { refresh } = useAuth();
  const [f, setF] = useState({ name: "", email: "", password: "", password2: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) return setErr(new Error("Las contraseñas no coinciden"));
    setBusy(true);
    setErr(null);
    try {
      await api.post("/auth/setup", { name: f.name, email: f.email, password: f.password });
      await refresh();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell subtitle="Configuración inicial">
      <form className="stack" onSubmit={submit}>
        <Alert tone="lime" icon={<ShieldCheck size={18} />}>Cree la cuenta del administrador. Después podrá dar de alta al resto del equipo desde Configuración.</Alert>
        <Field label="Nombre"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Correo electrónico"><input className="input" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Contraseña" hint="Mínimo 10 caracteres, con letras y números">
          <input className="input" type="password" autoComplete="new-password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Repita la contraseña"><input className="input" type="password" autoComplete="new-password" required value={f.password2} onChange={(e) => setF({ ...f, password2: e.target.value })} /></Field>
        <ErrorBox error={err} />
        <Button type="submit" variant="primary" loading={busy}>Crear administrador</Button>
      </form>
    </Shell>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const token = params.get("token") ?? "";
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (p1 !== p2) return setErr(new Error("Las contraseñas no coinciden"));
    setBusy(true);
    setErr(null);
    try {
      await api.post("/auth/reset", { token, password: p1 });
      setDone(true);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell subtitle="Nueva contraseña">
      {done ? (
        <div className="stack">
          <Alert tone="lime">Contraseña actualizada. Ya puede iniciar sesión.</Alert>
          <Button variant="primary" onClick={() => nav("/")}>Ir a iniciar sesión</Button>
        </div>
      ) : !token ? (
        <div className="stack"><Alert tone="red">Enlace no válido.</Alert><Link to="/">Volver</Link></div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field label="Nueva contraseña" hint="Mínimo 10 caracteres, con letras y números">
            <input className="input" type="password" autoComplete="new-password" required value={p1} onChange={(e) => setP1(e.target.value)} />
          </Field>
          <Field label="Repita la contraseña"><input className="input" type="password" autoComplete="new-password" required value={p2} onChange={(e) => setP2(e.target.value)} /></Field>
          <ErrorBox error={err} />
          <Button type="submit" variant="primary" loading={busy}>Guardar contraseña</Button>
        </form>
      )}
    </Shell>
  );
}
