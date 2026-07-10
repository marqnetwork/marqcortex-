import { useState } from 'react';
import { motion } from 'motion/react';
import { Brain, ArrowLeft, LogIn, Mail, Sparkles, CheckCircle2, Loader2, Shield, Lock } from 'lucide-react';
import { verifyClientEmail, DEMO_CLIENTS } from '@/app/services/dataService';
import { BRAND, GRADIENTS } from '@/app/utils/designTokens';

interface ClientLoginProps {
  onLogin: (submissionId: string, email: string, companyName: string, sessionToken?: string | null) => void;
  onBack: () => void;
}

export default function ClientLogin({ onLogin, onBack }: ClientLoginProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      const result = await verifyClientEmail(email);
      if (result.exists && result.submissionId) {
        onLogin(result.submissionId, email, result.companyName || 'Your Company', result.sessionToken ?? null);
      } else {
        setError('No diagnostic found for this email. Try one of the demo emails shown below.');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white flex items-center justify-center px-8 relative overflow-hidden">
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
          className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors"
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
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6 shadow-2xl"
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
            style={{ backgroundImage: `linear-gradient(135deg, #F5F5FF, ${BRAND.purple})` }}
          >
            Client Portal
          </motion.h1>
          
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-gray-500 text-lg"
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
            <label className="block text-sm font-semibold text-gray-200 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={20} />
              <motion.input
                whileFocus={{ scale: 1.01 }}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full pl-12 pr-4 py-4 bg-white/5 border-2 border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-[#8B5CF6] focus:outline-none transition-all"
              />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
              Use:&nbsp;
              {DEMO_CLIENTS.map((c) => (
                <button
                  key={c.email}
                  type="button"
                  onClick={() => setEmail(c.email)}
                  className="text-[#8B5CF6] hover:text-white font-mono bg-[#8B5CF6]/10 px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                >
                  {c.email}
                </button>
              ))}
            </div>
          </div>

          {/* Submit Button */}
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="w-full py-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-all relative overflow-hidden group"
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
              Access My Results
            </span>
          </motion.button>

          {/* Error Message */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-[#FD4438]/10 border border-[#FD4438]/30 rounded-xl"
            >
              <p className="text-sm text-[#FD4438] text-center font-medium">
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
          className="mt-6 p-5 bg-[#8B5CF6]/10 border border-[#8B5CF6]/20 rounded-xl"
        >
          <p className="text-xs font-semibold text-[#8B5CF6] mb-2 uppercase tracking-wider">
            Demo Email Addresses
          </p>
          <div className="space-y-1 text-sm">
            {DEMO_CLIENTS.map((c) => (
              <p key={c.email} className="text-gray-300">&bull; {c.email} <span className="text-gray-600">— {c.companyName}</span></p>
            ))}
          </div>
        </motion.div>

        {/* First Time User Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8 p-6 bg-white/3 backdrop-blur-sm border border-white/10 rounded-xl"
        >
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-[#8B5CF6]/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="text-[#8B5CF6]" size={20} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white mb-1">
                First time here?
              </p>
              <p className="text-sm text-gray-500 leading-relaxed">
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
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
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
                className="flex items-center gap-3 text-sm text-gray-500"
              >
                <div className="w-6 h-6 rounded-full bg-[#8B5CF6]/15 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 size={14} className="text-[#8B5CF6]" />
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
          <p className="text-sm text-gray-500">
            Didn't receive your results?{' '}
            <a
              href="mailto:support@marqcortex.com"
              className="text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
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
          className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-600"
        >
          <Lock size={12} />
          <span>Your data is protected with enterprise-grade security</span>
        </motion.div>
      </motion.div>
    </div>
  );
}