import { useAuth } from "../auth";

export default function Login() {
  const { signIn, error } = useAuth();
  return (
    <div className="center-screen">
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width="88" height="88" className="logo" />
      <h1 className="title-xl">Salary</h1>
      <p className="muted">Tu mes de un vistazo: lo real, lo proyectado y lo que queda por pagar.</p>
      <button className="btn primary wide" onClick={signIn}>Entrar con Google</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
