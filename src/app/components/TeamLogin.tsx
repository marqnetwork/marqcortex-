import { useState } from 'react';
import { motion } from 'motion/react';
import { Shield, ArrowLeft, LogIn, Eye, EyeOff, Loader2 } from 'lucide-react';
import { teamLogin } from '@/app/services/dataService';
import { FEATURES } from '@/config/features';

interface TeamLoginProps {
  onLogin: (accessToken: string) => void;
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
      if (FEATURES.BACKEND_INTEGRATION) {
        const result = await teamLogin(email, password);
        onLogin(result.accessToken);
      } else {
        // Demo mode: accept demo credentials without API call
        if (email === 'admin@marqcortex.com' && password === 'CortexAdmin2026!') {
          onLogin('demo_access_token_12345');
        } else {
          throw new Error('Invalid credentials. Use demo credentials shown below.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center px-8 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Floating Orbs */}
        <motion.div
          className="absolute w-96 h-96 rounded-full opacity-20 blur-3xl"
          style={{ 
            background: 'radial-gradient(circle, #8B5CF6, transparent)',
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
            background: 'radial-gradient(circle, #3B82F6, transparent)',
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
            backgroundImage: `linear-gradient(#8B5CF6 1px, transparent 1px), linear-gradient(90deg, #8B5CF6 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Animated Particles */}
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full bg-[#8B5CF6]"
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
          className="flex items-center gap-2 text-[#70707C] hover:text-white transition-colors"
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
            className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] rounded-2xl mb-6 shadow-2xl shadow-[#8B5CF6]/50"
          >
            <Shield size={40} className="text-white" />
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-5xl font-bold mb-3 bg-gradient-to-r from-[#F5F5FF] to-[#8B5CF6] bg-clip-text text-transparent"
            style={{ fontFamily: 'Inter' }}
          >
            Team Login
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-[#70707C] text-lg"
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
            <label htmlFor="team-email" className="block text-sm font-semibold text-[#F5F5FF] mb-2" style={{ fontFamily: 'Inter' }}>
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
              className="w-full p-4 bg-[#1a1a1a] border-2 border-[#242424] rounded-xl text-white placeholder:text-[#70707C] focus:border-[#8B5CF6] focus:outline-none transition-all"
              style={{ fontFamily: 'Inter' }}
            />
            <p className="mt-1.5 text-xs text-[#70707C] flex items-center gap-1.5" style={{ fontFamily: 'Inter' }}>
              Use:&nbsp;
              <button
                type="button"
                onClick={() => setEmail('admin@marqcortex.com')}
                className="text-[#06D7F6] hover:text-white font-mono bg-[#06D7F6]/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
              >
                admin@marqcortex.com
              </button>
            </p>
          </div>

          {/* Password Field */}
          <div>
            <label htmlFor="team-password" className="block text-sm font-semibold text-[#F5F5FF] mb-2" style={{ fontFamily: 'Inter' }}>
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
                className="w-full p-4 pr-12 bg-[#1a1a1a] border-2 border-[#242424] rounded-xl text-white placeholder:text-[#70707C] focus:border-[#8B5CF6] focus:outline-none transition-all"
                style={{ fontFamily: 'Inter' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[#70707C] hover:text-white transition-colors"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-[#70707C] flex items-center gap-1.5" style={{ fontFamily: 'Inter' }}>
              Use:&nbsp;
              <button
                type="button"
                onClick={() => setPassword('CortexAdmin2026!')}
                className="text-[#06D7F6] hover:text-white font-mono bg-[#06D7F6]/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
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
                  className="w-5 h-5 rounded-md bg-[#1a1a1a] border-2 border-[#242424] appearance-none checked:bg-gradient-to-br checked:from-[#8B5CF6] checked:to-[#3B82F6] checked:border-[#8B5CF6] cursor-pointer transition-all"
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
              <span className="text-[#70707C] group-hover:text-white transition-colors" style={{ fontFamily: 'Inter' }}>
                Remember me
              </span>
            </label>
            <button
              type="button"
              className="text-[#8B5CF6] hover:text-[#3B82F6] transition-colors font-medium"
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
            className="w-full py-4 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] rounded-xl text-lg font-bold flex items-center justify-center gap-2 hover:shadow-2xl hover:shadow-[#8B5CF6]/50 transition-all relative overflow-hidden group disabled:opacity-70 disabled:cursor-not-allowed"
            style={{ fontFamily: 'Inter' }}
          >
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6]"
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
              className="p-4 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl"
            >
              <p className="text-sm text-[#FD4438] text-center font-medium" style={{ fontFamily: 'Inter' }}>
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
          className="mt-6 p-5 bg-[#06D7F6]/10 border border-[#06D7F6]/30 rounded-xl"
        >
          <p className="text-xs font-semibold text-[#06D7F6] mb-2 uppercase tracking-wider" style={{ fontFamily: 'Inter' }}>
            Demo Credentials
          </p>
          <div className="space-y-1 text-sm" style={{ fontFamily: 'Inter' }}>
            <p className="text-[#F5F5FF]"><span className="text-[#70707C]">Email:</span> admin@marqcortex.com</p>
            <p className="text-[#F5F5FF]"><span className="text-[#70707C]">Password:</span> CortexAdmin2026!</p>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}