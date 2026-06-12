import { useState, type FormEvent, type JSX } from 'react';
import { api, ApiError } from '../api';
import type { Session } from '../types';

interface LoginProps {
  onSuccess: (session: Session) => void;
}

export function Login({ onSuccess }: LoginProps): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const session = await api.login(username.trim(), password);
      onSuccess(session);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Неверный логин или пароль');
      } else {
        setError('Не удалось войти. Попробуйте позже.');
      }
      setLoading(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit}>
        <img
          className="login__icon"
          src="/icons/icon-192.png"
          alt=""
          width={72}
          height={72}
        />
        <h1 className="login__title">Вход</h1>
        <p className="login__subtitle">Задачи команды</p>

        <label className="login__field">
          <span className="login__label">Логин</span>
          <input
            className="login__input"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            required
            autoFocus
          />
        </label>

        <label className="login__field">
          <span className="login__label">Пароль</span>
          <input
            className="login__input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
          />
        </label>

        {error && <div className="login__error">{error}</div>}

        <button
          className="btn btn--primary login__submit"
          type="submit"
          disabled={loading || !username.trim() || !password}
        >
          {loading ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
