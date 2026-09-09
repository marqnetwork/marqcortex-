import { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, ArrowLeft, LogIn, Eye, EyeOff, Loader2 } from 'lucide-react';
import { teamLogin } from '@/app/services/dataService';
import {
  brand,
} from '@/app/lib/tokens';


interface TeamLoginProps {
  /**
   * `user` is the login response's user object, unnarrowed. The session layer
   * owns what a team identity is (`normaliseTeamUser`), so this component
   * hands the response through rather than reshaping it on the way.
   */
  onLogin: (accessToken: string, user?: unknown) => void;
  onBack: () => void;
}

export default function TeamLogin({ onLogin, onBack }: TeamLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      // One login path, both modes. `dataService.teamLogin` already branches on
      // demo mode and returns the same shape either way — including the user.
      // This component used to re-implement the demo branch inline and call
      // `onLogin(token)` with no user at all, so a demo session carried no
      // identity: the console greeted "Team" and the sidebar had nobody to
      // name. Deleting the duplicate fixes that and removes a second copy of
      // the demo credentials from the source.
      const result = await teamLogin(email, password);
      onLogin(result.accessToken, result.user ?? null);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-cortex-canvas text-white flex items-center justify-center px-8 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Floating Orbs */}
        <motion.div
          className="absolute w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ 
            background: `radial-gradient(circle, ${brand.accent}, transparent)`,
            top: '10%',
            left: '10%'
          }}
          animate={{
            x: ['-10%', '10%', '-10%'],
            y: ['-10%', '15%', '-10%'],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ 
            background: `radial-gradient(circle, ${brand.accentAlt}, transparent)`,
            bottom: '10%',
            right: '10%'
          }}
          animate={{
            x: ['10%', '-10%', '10%'],
            y: ['10%', '-10%', '10%'],
          }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Grid Pattern */}
        <div 
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(${brand.accent} 1px, transparent 1px), linear-gradient(90deg, ${brand.accent} 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Animated Particles */}
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-cortex-accent"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -30, 0],
              opacity: [0, 0.6, 0],
            }}
            transition={{
              duration: 3 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 5,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Back Button */}
      <div className="absolute top-8 left-8 z-10">
        <motion.button
          onClick={onBack}
          whileHover={{ x: -4 }}
          whileTap={{ scale: 0.95 }}
          className="flex items-center gap-2 text-cortex-neutral hover:text-white transition-colors"
          style={{ fontFamily: 'Inter' }}
          aria-label="Back to home"
        >
          <ArrowLeft size={20} />
          Back to Home
        </motion.button>
      </div>

      {/* Login Card */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, type: "spring" }}
        className="w-full max-w-md relative z-10"
        role="main"
        aria-label="Team login"
      >
        {/* Header */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-cortex-accent to-cortex-accent-alt rounded-cortex-lg mb-6 shadow-2xl shadow-cortex-accent/50"
          >
            <Shield size={40} className="text-white" />
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-5xl font-bold mb-3 bg-gradient-to-r from-cortex-primary to-cortex-accent bg-clip-text text-transparent"
            style={{ fontFamily: 'Inter' }}
          >
            Team Login
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-cortex-neutral text-lg"
            style={{ fontFamily: 'Inter' }}
          >
            Access the MARQ Cortex internal dashboard
          </motion.p>
        </div>

        {/* Login Form */}
        <motion.form
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          onSubmit={handleSubmit}
          className="space-y-6"
        >
          {/* Email Field */}
          <div>
            <label htmlFor="team-email" className="block text-sm font-semibold text-cortex-primary mb-2" style={{ fontFamily: 'Inter' }}>
              Email Address
            </label>
            <motion.input
              id="team-email"
              whileFocus={{ scale: 1.01 }}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="team@company.com"
              required
              autoComplete="email"
              className="w-full p-4 bg-cortex-overlay border-2 border-cortex-strong rounded-cortex-md text-white placeholder:text-cortex-neutral focus:border-cortex-accent focus:outline-none transition-all"
              style={{ fontFamily: 'Inter' }}
            />
            <p className="mt-1.5 text-xs text-cortex-neutral flex items-center gap-1.5" style={{ fontFamily: 'Inter' }}>
              Use:&nbsp;
              <button
                type="button"
                onClick={() => setEmail('admin@marqcortex.com')}
                className="text-cortex-info hover:text-white font-mono bg-cortex-info/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                admin@marqcortex.com
              </button>
            </p>
          </div>

          {/* Password Field */}
          <div>
            <label htmlFor="team-password" className="block text-sm font-semibold text-cortex-primary mb-2" style={{ fontFamily: 'Inter' }}>
              Password
            </label>
            <div className="relative">
              <motion.input
                id="team-password"
                whileFocus={{ scale: 1.01 }}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full p-4 pr-12 bg-cortex-overlay border-2 border-cortex-strong rounded-cortex-md text-white placeholder:text-cortex-neutral focus:border-cortex-accent focus:outline-none transition-all"
                style={{ fontFamily: 'Inter' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-cortex-neutral hover:text-white transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-cortex-neutral flex items-center gap-1.5" style={{ fontFamily: 'Inter' }}>
              Use:&nbsp;
              <button
                type="button"
                onClick={() => setPassword('CortexAdmin2026!')}
                className="text-cortex-info hover:text-white font-mono bg-cortex-info/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                CortexAdmin2026!
              </button>
            </p>
          </div>

          {/* Remember Me & Forgot Password */}
          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 cursor-pointer group">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-5 h-5 rounded-md bg-cortex-overlay border-2 border-cortex-strong appearance-none checked:bg-gradient-to-br checked:from-cortex-accent checked:to-cortex-accent-alt checked:border-cortex-accent cursor-pointer transition-all"
                />
                {rememberMe && (
                  <motion.svg
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute inset-0 w-5 h-5 text-white pointer-events-none"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </motion.svg>
                )}
              </div>
              <span className="text-cortex-neutral group-hover:text-white transition-colors" style={{ fontFamily: 'Inter' }}>
                Remember me
              </span>
            </label>
            <button
              type="button"
              className="text-cortex-accent hover:text-cortex-accent-alt transition-colors font-medium"
              style={{ fontFamily: 'Inter' }}
            >
              Forgot password?
            </button>
          </div>

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={isLoading}
            whileHover={{ scale: isLoading ? 1 : 1.02, y: isLoading ? 0 : -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-4 bg-gradient-to-r from-cortex-accent to-cortex-accent-alt rounded-cortex-md text-lg font-bold flex items-center justify-center gap-2 hover:shadow-2xl hover:shadow-cortex-accent/50 transition-all relative overflow-hidden group disabled:opacity-70 disabled:cursor-not-allowed"
            style={{ fontFamily: 'Inter' }}
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-cortex-accent-alt to-cortex-accent"
              initial={{ x: '100%' }}
              whileHover={{ x: 0 }}
              transition={{ duration: 0.3 }}
            />
            <span className="relative z-10 flex items-center gap-2">
              {isLoading ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />}
              {isLoading ? 'Signing in...' : 'Sign In to MARQ Cortex'}
            </span>
          </motion.button>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-cortex-danger/10 border border-cortex-danger/30 rounded-cortex-md"
            >
              <p className="text-sm text-cortex-danger text-center font-medium" style={{ fontFamily: 'Inter' }}>
                {error}
              </p>
            </motion.div>
          )}
        </motion.form>

        {/* Demo Credentials Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 p-5 bg-cortex-info/10 border border-cortex-info/30 rounded-cortex-md"
        >
          <p className="text-xs font-semibold text-cortex-info mb-2 uppercase tracking-wider" style={{ fontFamily: 'Inter' }}>
            Demo Credentials
          </p>
          <div className="space-y-1 text-sm" style={{ fontFamily: 'Inter' }}>
            <p className="text-cortex-primary"><span className="text-cortex-neutral">Email:</span> admin@marqcortex.com</p>
            <p className="text-cortex-primary"><span className="text-cortex-neutral">Password:</span> CortexAdmin2026!</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}