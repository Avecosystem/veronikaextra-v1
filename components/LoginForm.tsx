// components/LoginForm.tsx
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import Input from './ui/Input';
import Button from './ui/Button';
import { useAuth } from '../hooks/useAuth';

const LoginForm: React.FC = () => {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const { login, loading, error } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(email, password);
  };

  return (
    <AuthLayout title="Sign In to Your Account">
      <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
        <div className="rounded-md shadow-sm -space-y-px">
          <Input
            id="email-address"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4"
          />
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <div>
          <Button
            type="submit"
            className="w-full justify-center mt-6"
            loading={loading}
          >
            Sign In
          </Button>
        </div>

        <div className="text-sm text-center">
          <p className="text-gray-500 dark:text-gray-400">
            Don't have an account?{' '}
            <NavLink to="/signup" className="font-medium text-accent hover:underline">
              Sign Up
            </NavLink>
          </p>
        </div>
      </form>
    </AuthLayout>
  );
};

export default LoginForm;