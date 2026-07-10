import { motion, AnimatePresence } from 'motion/react';
import { X, Zap, Check, Clock, FileText, Target } from 'lucide-react';

interface ProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  milestone: 25 | 50 | 75;
  darkMode?: boolean;
}

const milestoneContent = {
  25: {
    headline: "🎯 You're 25% there",
    body: "Your answers so far are already revealing patterns. Keep going — the insights get better with every question.",
    questionsComplete: 4,
    questionsRemaining: 10,
    timeSpent: 3,
  },
  50: {
    headline: "⚡ Halfway done",
    body: "Most businesses quit here. You're not most businesses. The next 7 questions will unlock your custom roadmap.",
    questionsComplete: 7,
    questionsRemaining: 7,
    timeSpent: 6,
  },
  75: {
    headline: "🔥 Almost there",
    body: "The last few questions are the most valuable. They help us prioritize what to fix first.",
    questionsComplete: 11,
    questionsRemaining: 3,
    timeSpent: 10,
  },
};

export default function ProgressModal({ isOpen, onClose, milestone, darkMode = false }: ProgressModalProps) {
  const content = milestoneContent[milestone];
  const totalQuestions = 14;
  const progressPercent = milestone;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0"
            style={{
              background: 'rgba(11, 14, 20, 0.92)',
              backdropFilter: 'blur(12px)',
            }}
            onClick={onClose}
          />

          {/* Modal Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className={`relative w-[640px] h-[520px] rounded-[24px] ${
              darkMode ? 'bg-[#161B26]' : 'bg-white'
            }`}
            style={{
              boxShadow: '0 32px 64px rgba(0, 0, 0, 0.4)',
              padding: '56px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Progress Icon - Floating above card */}
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="absolute left-1/2 -top-[60px] transform -translate-x-1/2"
            >
              <motion.div
                animate={{
                  scale: [1, 1.05, 1],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
                className="w-[120px] h-[120px] rounded-full bg-[#00FF85] flex items-center justify-center"
                style={{
                  boxShadow: '0 12px 32px rgba(0, 255, 133, 0.5)',
                }}
              >
                {milestone === 75 ? (
                  <Check size={60} className="text-white" strokeWidth={3} />
                ) : (
                  <Zap size={60} className="text-white" strokeWidth={3} fill="white" />
                )}
              </motion.div>
            </motion.div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className={`absolute top-5 right-5 w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                darkMode
                  ? 'text-[#9AA4BF] hover:bg-[#1F2937]'
                  : 'text-[#9AA4BF] hover:bg-[#F5F5F5]'
              }`}
            >
              <X size={20} />
            </button>

            {/* Content Container */}
            <div className="flex flex-col items-center pt-6">
              {/* Headline */}
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: 0.4 }}
                className={`text-[42px] font-bold text-center mb-7 ${
                  darkMode ? 'text-white' : 'text-[#0A0A0A]'
                }`}
                style={{ fontFamily: 'Inter', letterSpacing: '-1px' }}
              >
                {content.headline}
              </motion.h2>

              {/* Body Text */}
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4, duration: 0.4 }}
                className={`text-[19px] text-center leading-[1.7] max-w-[480px] mb-10 ${
                  darkMode ? 'text-[#9AA4BF]' : 'text-[#707070]'
                }`}
                style={{ fontFamily: 'Inter' }}
              >
                {content.body}
              </motion.p>

              {/* Progress Visualization */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5, duration: 0.4 }}
                className="w-full mb-8"
              >
                <div className="relative">
                  {/* Progress Bar */}
                  <div
                    className={`h-3 rounded-md overflow-hidden ${
                      darkMode ? 'bg-[#1F2937]' : 'bg-[#E5E5E5]'
                    }`}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ delay: 0.6, duration: 1, ease: 'easeOut' }}
                      className="h-full rounded-md"
                      style={{
                        background: 'linear-gradient(90deg, #00FF85 0%, #00D670 100%)',
                      }}
                    />
                  </div>

                  {/* Percentage Badge */}
                  <div
                    className="absolute -top-1 right-0 text-[28px] font-bold text-[#00FF85]"
                    style={{ fontFamily: 'Inter' }}
                  >
                    {progressPercent}%
                  </div>
                </div>

                {/* Progress Text */}
                <p
                  className={`text-sm font-medium text-center mt-3 ${
                    darkMode ? 'text-[#9AA4BF]' : 'text-[#707070]'
                  }`}
                  style={{ fontFamily: 'Inter' }}
                >
                  {content.questionsComplete} of {totalQuestions} questions complete
                </p>
              </motion.div>

              {/* Stats Row */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.4 }}
                className="w-full grid grid-cols-3 gap-6 mb-12"
              >
                {/* Time Spent */}
                <div className="flex flex-col items-center">
                  <div className="text-[32px] mb-1">⏱️</div>
                  <div
                    className={`text-lg font-bold mb-1 ${
                      darkMode ? 'text-white' : 'text-[#0A0A0A]'
                    }`}
                    style={{ fontFamily: 'Inter' }}
                  >
                    {content.timeSpent} min
                  </div>
                  <div
                    className={`text-[13px] ${darkMode ? 'text-[#9AA4BF]' : 'text-[#707070]'}`}
                    style={{ fontFamily: 'Inter' }}
                  >
                    Time invested
                  </div>
                </div>

                {/* Questions Done */}
                <div className="flex flex-col items-center">
                  <div className="text-[32px] mb-1">📝</div>
                  <div
                    className={`text-lg font-bold mb-1 ${
                      darkMode ? 'text-white' : 'text-[#0A0A0A]'
                    }`}
                    style={{ fontFamily: 'Inter' }}
                  >
                    {content.questionsComplete} answered
                  </div>
                  <div
                    className={`text-[13px] ${darkMode ? 'text-[#9AA4BF]' : 'text-[#707070]'}`}
                    style={{ fontFamily: 'Inter' }}
                  >
                    Questions done
                  </div>
                </div>

                {/* Questions Remaining */}
                <div className="flex flex-col items-center">
                  <div className="text-[32px] mb-1">🎯</div>
                  <div
                    className={`text-lg font-bold mb-1 ${
                      darkMode ? 'text-white' : 'text-[#0A0A0A]'
                    }`}
                    style={{ fontFamily: 'Inter' }}
                  >
                    {content.questionsRemaining} to go
                  </div>
                  <div
                    className={`text-[13px] ${darkMode ? 'text-[#9AA4BF]' : 'text-[#707070]'}`}
                    style={{ fontFamily: 'Inter' }}
                  >
                    Almost there
                  </div>
                </div>
              </motion.div>

              {/* CTA Button */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.4 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="w-full h-16 bg-[#00FF85] text-[#0A0A0A] font-bold text-lg rounded-xl transition-all"
                style={{
                  fontFamily: 'Inter',
                  boxShadow: '0 6px 20px rgba(0, 255, 133, 0.4)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 10px 30px rgba(0, 255, 133, 0.6)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0, 255, 133, 0.4)';
                }}
              >
                Keep Going →
              </motion.button>
            </div>
          </motion.div>

          {/* Optional: Subtle confetti particles */}
          {milestone === 75 && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              {[...Array(20)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{
                    x: '50%',
                    y: '50%',
                    opacity: 1,
                    scale: 0,
                  }}
                  animate={{
                    x: `${50 + (Math.random() - 0.5) * 100}%`,
                    y: `${50 + (Math.random() - 0.5) * 100}%`,
                    opacity: 0,
                    scale: 1,
                  }}
                  transition={{
                    duration: 1.5 + Math.random(),
                    delay: i * 0.05,
                    ease: 'easeOut',
                  }}
                  className="absolute w-2 h-2 rounded-full"
                  style={{
                    background: ['#00FF85', '#00D670', '#FFD700', '#FF6B6B'][
                      Math.floor(Math.random() * 4)
                    ],
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </AnimatePresence>
  );
}
