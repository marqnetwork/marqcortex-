import { useState } from 'react';
import { motion } from 'motion/react';
import { Brain, ArrowLeft, LogIn, Mail, Sparkles, CheckCircle2, Loader2, Shield, Lock, KeyRound } from 'lucide-react';
import {
  requestClientSignInCode,
  exchangeClientSignInCode,
  DEMO_CLIENTS,
} from '@/app/services/dataService';
import { isDemoMode } from '@/config/runtime';
import { BRAND, GRADIENTS } from '@/app/utils/designTokens';
import { text } from '@/app/lib/tokens';

interface ClientLoginProps {
  onLogin: (submissionId: string, email: string, companyName: string, sessionToken?: string | null) => void;
  onBack: () => void;
}

/**
 * Client portal sign-in, in two steps.
 *
 * It used to be one: type an address, and you were in. The server handed back a
 * session token for whatever address it was given, so knowing a client's email
 * was the same as being them — and their diagnostic answers, report and
 * proposal are not things a stranger should be able to read. See
 * `supabase/functions/server/security/clientChallenge.ts`.
 *
 * The extra step is a code sent to the mailbox. That is the whole of the change
 * to what a client does here, and it is the smallest step that actually tests
 * the claim the address makes.
 *
 * The first step says the same thing whatever the address turns out to be. It
 * is not a friendlier error — the old "no diagnostic found for this email" let
 * anybody test a list of addresses for MARQ clients.
 */
export default function ClientLogin({ onLogin, onBack }: ClientLoginProps) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await requestClientSignInCode(email);
      setNotice(result.message);
      setStep('code');
      setCode('');
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code.trim()) {
      setError('Enter the code from your email.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await exchangeClientSignInCode(email, code.trim());
      if (result.exists && result.submissionId) {
        onLogin(result.submissionId, email, result.companyName || 'Your Company', result.sessionToken ?? null);
      } else {
        setError('That code is not valid. Request a new one.');
      }
    } catch (err: any) {
      setError(err.message || 'That code is not valid. Request a new one.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = step === 'email' ? handleRequestCode : handleSubmitCode;
  return (
    <div className="min-h-screen bg-cortex-canvas text-white flex items-center justify-center px-8 relative overflow-hidden">
      {/* Animated Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* Floating Orbs — unified purple/blue brand */}
        <motion.div
          className="absolute w-96 h-96 rounded-full opacity-15 blur-3xl"
          style={{ 
            background: GRADIENTS.orbPurple,
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
          className="absolute w-96 h-96 rounded-full opacity-15 blur-3xl"
          style={{ 
            background: GRADIENTS.orbBlue,
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
            backgroundImage: `linear-gradient(${BRAND.purple} 1px, transparent 1px), linear-gradient(90deg, ${BRAND.purple} 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />

        {/* Animated Particles */}
        {[...Array(15)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-1 h-1 rounded-full"
            style={{
              backgroundColor: BRAND.purple,
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
          className="flex items-center gap-2 text-cortex-muted hover:text-white transition-colors"
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
      >
        {/* Header — unified MARQ Cortex brand */}
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
            className="inline-flex items-center justify-center w-20 h-20 rounded-cortex-lg mb-6 shadow-2xl"
            style={{
              background: GRADIENTS.primaryButton,
              boxShadow: `0 20px 60px ${BRAND.purpleGlow}`,
            }}
          >
            <Brain size={40} className="text-white" />
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-5xl font-bold mb-3 bg-clip-text text-transparent"
            style={{ backgroundImage: `linear-gradient(135deg, ${text.primary}, ${BRAND.purple})` }}
          >
            Client Portal
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-cortex-muted text-lg"
          >
            Access your diagnostic results & insights
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
            {/* The label was styled text with no `htmlFor`, so it named the
                field on screen and to nobody else: a screen-reader user reached
                an edit box announced only by its placeholder, which vanishes as
                soon as they start typing. */}
            <label htmlFor="client-login-email" className="block text-sm font-semibold text-cortex-secondary mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-cortex-muted" size={20} aria-hidden="true" />
              <motion.input
                id="client-login-email"
                whileFocus={{ scale: 1.01 }}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                readOnly={step === 'code'}
                className="w-full pl-12 pr-4 py-4 bg-cortex-control border-2 border-cortex-default rounded-cortex-md text-white placeholder:text-cortex-faint focus:border-cortex-accent focus:outline-none transition-all read-only:opacity-70"
              />
            </div>
            {isDemoMode() && step === 'email' && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-cortex-muted">
                Use:&nbsp;
                {DEMO_CLIENTS.map((c) => (
                  <button
                    key={c.email}
                    type="button"
                    onClick={() => setEmail(c.email)}
                    className="text-cortex-accent hover:text-white font-mono bg-cortex-accent/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                  >
                    {c.email}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Code Field — step two */}
          {step === 'code' && (
            <div>
              <label htmlFor="client-login-code" className="block text-sm font-semibold text-cortex-secondary mb-2">
                Sign-in Code
              </label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-cortex-muted" size={20} aria-hidden="true" />
                <motion.input
                  id="client-login-code"
                  whileFocus={{ scale: 1.01 }}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  required
                  autoFocus
                  className="w-full pl-12 pr-4 py-4 bg-cortex-control border-2 border-cortex-default rounded-cortex-md text-white text-center text-2xl font-mono tracking-[0.5em] placeholder:text-cortex-faint placeholder:tracking-[0.5em] focus:border-cortex-accent focus:outline-none transition-all"
                />
              </div>
              <button
                type="button"
                onClick={() => { setStep('email'); setError(''); setNotice(''); }}
                className="mt-2 text-xs text-cortex-accent hover:text-white transition-colors"
              >
                Use a different email address
              </button>
            </div>
          )}

          {/* Submit Button */}
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-4 rounded-cortex-md text-lg font-bold flex items-center justify-center gap-2 transition-all relative overflow-hidden group"
            style={{
              background: GRADIENTS.primaryButton,
              boxShadow: `0 10px 40px ${BRAND.purpleGlow}`,
            }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.purple})` }}
              initial={{ x: '100%' }}
              whileHover={{ x: 0 }}
              transition={{ duration: 0.3 }}
            />
            <span className="relative z-10 flex items-center gap-2 text-white">
              {isLoading ? <Loader2 size={20} className="animate-spin" /> : <LogIn size={20} />}
              {step === 'email' ? 'Send Me a Sign-in Code' : 'Access My Results'}
            </span>
          </motion.button>

          {/* Notice — the same wording whatever the address turns out to be. */}
          {notice && !error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-cortex-accent/10 border border-cortex-accent/30 rounded-cortex-md"
              role="status"
            >
              <p className="text-sm text-cortex-secondary text-center font-medium">
                {notice}
              </p>
            </motion.div>
          )}

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-cortex-danger/10 border border-cortex-danger/30 rounded-cortex-md"
              role="alert"
            >
              <p className="text-sm text-cortex-danger text-center font-medium">
                {error}
              </p>
            </motion.div>
          )}
        </motion.form>

        {/* Demo Email Addresses */}
        {isDemoMode() && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-6 p-5 bg-cortex-accent/10 border border-cortex-accent/20 rounded-cortex-md"
        >
          <p className="text-xs font-semibold text-cortex-accent mb-2 uppercase tracking-wider">
            Demo Email Addresses
          </p>
          <div className="space-y-1 text-sm">
            {DEMO_CLIENTS.map((c) => (
              <p key={c.email} className="text-cortex-secondary">&bull; {c.email} <span className="text-cortex-faint">— {c.companyName}</span></p>
            ))}
          </div>
        </motion.div>
        )}

        {/* First Time User Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8 p-6 bg-white/3 backdrop-blur-sm border border-cortex-default rounded-cortex-md"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-cortex-sm bg-cortex-accent/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="text-cortex-accent" size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">
                First time here?
              </p>
              <p className="text-sm text-cortex-muted leading-relaxed">
                Complete a diagnostic assessment first, and we'll send you a secure link to access your personalized results and recommendations.
              </p>
            </div>
          </div>
        </motion.div>

        {/* How It Works */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mt-6 space-y-3"
        >
          <p className="text-xs font-semibold text-cortex-muted uppercase tracking-wider">
            How it works
          </p>
          <div className="space-y-2">
            {[
              'Complete the diagnostic questionnaire',
              'Receive email with secure access link',
              'View your comprehensive results here',
            ].map((step, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8 + index * 0.1 }}
                className="flex items-center gap-3 text-sm text-cortex-muted"
              >
                <div className="w-6 h-6 rounded-full bg-cortex-accent/15 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={14} className="text-cortex-accent" />
                </div>
                {step}
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Support Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-8 text-center"
        >
          <p className="text-sm text-cortex-muted">
            Didn't receive your results?{' '}
            <a
              href="mailto:support@marqcortex.com"
              className="text-cortex-accent hover:text-cortex-accent-light transition-colors font-medium"
            >
              Contact support
            </a>
          </p>
        </motion.div>

        {/* Security Badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-6 flex items-center justify-center gap-2 text-xs text-cortex-faint"
        >
          <Lock size={12} />
          <span>Your data is protected with enterprise-grade security</span>
        </motion.div>
      </motion.div>
    </div>
  );
}