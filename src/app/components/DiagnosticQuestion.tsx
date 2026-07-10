import { useState } from 'react';
import { motion } from 'motion/react';
import { Calendar, AlertCircle, HelpCircle } from 'lucide-react';
import ProgressModal from '@/app/components/ProgressModal';

interface ExampleScenario {
  number: number;
  text: string;
}

const exampleScenarios: ExampleScenario[] = [
  {
    number: 1,
    text: '"Every morning starts with 50 unread emails and by noon I\'m still firefighting instead of doing strategic work. I haven\'t had time to think strategically in weeks."',
  },
  {
    number: 2,
    text: '"My team waits for me to approve everything, so I\'m the bottleneck. Even simple decisions get delayed because they need my sign-off."',
  },
  {
    number: 3,
    text: '"We lose track of customer requests between email, WhatsApp, and our CRM. Things fall through the cracks weekly and we only find out when customers complain."',
  },
];

export default function DiagnosticQuestion() {
  const [answer, setAnswer] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [modalMilestone, setModalMilestone] = useState<25 | 50 | 75>(50);
  const maxChars = 2000;
  const currentQuestion = 3;
  const totalQuestions = 14;
  const progressPercent = (currentQuestion / totalQuestions) * 100;

  return (
    <div className="min-h-screen bg-[#FAFAFA] relative">
      {/* Subtle background pattern for "daily chaos" theme */}
      <div className="absolute inset-0 opacity-[0.015] pointer-events-none">
        <div className="absolute top-20 left-10 text-8xl text-orange-500 opacity-30">🕐</div>
        <div className="absolute top-40 right-20 text-6xl text-orange-500 opacity-20">⏰</div>
        <div className="absolute bottom-40 left-1/4 text-7xl text-orange-500 opacity-25">📅</div>
        <div className="absolute top-1/3 right-1/3 text-5xl text-orange-500 opacity-20">⏱️</div>
      </div>
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,165,0,0.01) 0%, transparent 50%)',
        }}
      />

      {/* Header Bar */}
      <header 
        className="fixed top-0 left-0 right-0 h-[72px] z-50 border-b border-[#E5E5E5]"
        style={{
          background: 'rgba(255,255,255,0.95)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="max-w-[1440px] mx-auto px-10 h-full flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-baseline">
            <span className="text-2xl font-bold text-[#0A0A0A] tracking-tight" style={{ fontFamily: 'Inter' }}>
              MAR
            </span>
            <span className="relative text-2xl font-bold text-[#0A0A0A] tracking-tight" style={{ fontFamily: 'Inter' }}>
              Q
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#00FF85]"></span>
            </span>
          </div>

          {/* Section Indicator */}
          <div 
            className="text-[11px] font-bold text-[#00FF85] uppercase tracking-wider"
            style={{ fontFamily: 'Inter', letterSpacing: '1.5px' }}
          >
            Section 1: Business Reality
          </div>

          {/* Progress */}
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end gap-2">
              <span className="text-sm font-medium text-[#707070]" style={{ fontFamily: 'Inter' }}>
                Question {currentQuestion} of {totalQuestions}
              </span>
              <div className="w-40 h-1.5 bg-[#E5E5E5] rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-[#00FF85] rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>
            <button 
              className="text-sm text-[#00FF85] hover:underline"
              style={{ fontFamily: 'Inter' }}
            >
              Why this matters?
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-[72px] min-h-screen flex items-center justify-center">
        <div className="w-full max-w-[1000px] px-[60px] py-20">
          {/* Contextual Icon with Background Circle */}
          <div className="flex flex-col items-center mb-12">
            <div className="relative">
              {/* Background circle with glow */}
              <div 
                className="absolute inset-0 flex items-center justify-center"
                style={{
                  width: '200px',
                  height: '200px',
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div 
                  className="w-full h-full rounded-full bg-[#F0FFF9]"
                  style={{
                    boxShadow: '0 0 60px rgba(0,255,133,0.2)',
                  }}
                />
              </div>
              
              {/* Icon */}
              <div className="relative flex items-center justify-center" style={{ width: '140px', height: '140px' }}>
                <div className="absolute inset-0 flex items-center justify-center">
                  <Calendar size={100} className="text-[#00FF85]" strokeWidth={1.5} />
                </div>
                <div className="absolute top-2 right-2">
                  <AlertCircle size={40} className="text-[#00FF85] opacity-20" strokeWidth={1.5} />
                </div>
              </div>
            </div>

            {/* Question Number Badge */}
            <div 
              className="mt-10 bg-white border border-[#E5E5E5] px-5 py-2 rounded-full"
              style={{ fontFamily: 'Inter' }}
            >
              <span className="text-[13px] font-medium text-[#707070]">
                Question {currentQuestion} of {totalQuestions}
              </span>
            </div>
          </div>

          {/* Question Text */}
          <div className="text-center mb-4">
            <h1 
              className="text-4xl font-bold text-[#0A0A0A] leading-[1.3] max-w-[840px] mx-auto"
              style={{ fontFamily: 'Inter' }}
            >
              Walk us through a normal workday that feels frustrating, exhausting, or chaotic for you or your team.
            </h1>
          </div>

          {/* Helper Text */}
          <p 
            className="text-center text-base text-[#707070] italic mb-12"
            style={{ fontFamily: 'Inter' }}
          >
            (We're not looking for perfection — we're looking for reality.)
          </p>

          {/* Text Area */}
          <div className="relative mb-10">
            <textarea
              value={answer}
              onChange={(e) => {
                if (e.target.value.length <= maxChars) {
                  setAnswer(e.target.value);
                }
              }}
              placeholder="Type your answer here..."
              className="w-full h-[320px] bg-white border-2 border-[#E5E5E5] rounded-2xl p-7 text-[17px] text-[#0A0A0A] leading-[1.7] resize-none focus:border-[#00FF85] focus:outline-none transition-all duration-200 placeholder:text-[#9AA4BF] placeholder:italic"
              style={{ 
                fontFamily: 'Inter',
                boxShadow: answer.length > 0 ? '0 0 0 4px rgba(0,255,133,0.1)' : 'none',
              }}
            />
            <div 
              className="absolute bottom-5 right-7 text-xs text-[#9AA4BF]"
              style={{ fontFamily: 'Inter' }}
            >
              {answer.length} / {maxChars}
            </div>
          </div>

          {/* Example Scenarios Panel */}
          <div 
            className="rounded-xl p-8 border border-[#00FF85] border-l-4"
            style={{
              background: 'linear-gradient(135deg, #F0FFF9 0%, #FFFFFF 100%)',
            }}
          >
            <div 
              className="text-base font-bold text-[#0A0A0A] mb-6"
              style={{ fontFamily: 'Inter' }}
            >
              💡 Example scenarios to guide your answer:
            </div>

            <div className="space-y-5">
              {exampleScenarios.map((example) => (
                <motion.div
                  key={example.number}
                  whileHover={{ backgroundColor: 'rgba(240,255,249,0.5)' }}
                  className="flex gap-4 p-4 rounded-lg transition-colors"
                >
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#00FF85] flex items-center justify-center">
                    <span className="text-sm font-bold text-[#0A0A0A]" style={{ fontFamily: 'Inter' }}>
                      {example.number}
                    </span>
                  </div>
                  <p 
                    className="text-[15px] text-[#707070] leading-[1.6] pt-0.5"
                    style={{ fontFamily: 'Inter' }}
                  >
                    {example.text}
                  </p>
                </motion.div>
              ))}
            </div>

            <button 
              className="mt-6 text-sm font-medium text-[#00FF85] hover:underline flex items-center gap-2"
              style={{ fontFamily: 'Inter' }}
            >
              <HelpCircle size={16} />
              Need more guidance?
            </button>
          </div>
        </div>
      </main>

      {/* Navigation Buttons - Fixed Bottom */}
      <div 
        className="fixed bottom-0 left-0 right-0 border-t border-[#E5E5E5] z-40"
        style={{
          background: 'rgba(255,255,255,0.98)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <div className="max-w-[1000px] mx-auto px-10 py-6 flex justify-end gap-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="bg-transparent border-2 border-[#E5E5E5] text-[#0A0A0A] font-bold text-base px-8 py-4 rounded-[10px] hover:border-[#00FF85] hover:bg-[#F0FFF9] transition-all"
            style={{ fontFamily: 'Inter' }}
          >
            ← Back
          </motion.button>

          <motion.button
            whileHover={answer.length > 0 ? { y: -2 } : {}}
            whileTap={answer.length > 0 ? { scale: 0.98 } : {}}
            disabled={answer.length === 0}
            className={`font-bold text-base px-12 py-4 rounded-[10px] transition-all ${
              answer.length > 0
                ? 'bg-[#00FF85] text-[#0A0A0A] cursor-pointer'
                : 'bg-[#E5E5E5] text-[#9AA4BF] cursor-not-allowed'
            }`}
            style={{
              fontFamily: 'Inter',
              boxShadow: answer.length > 0 ? '0 4px 16px rgba(0,255,133,0.3)' : 'none',
            }}
            onMouseEnter={(e) => {
              if (answer.length > 0) {
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,255,133,0.4)';
              }
            }}
            onMouseLeave={(e) => {
              if (answer.length > 0) {
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,255,133,0.3)';
              }
            }}
          >
            Continue →
          </motion.button>
        </div>
      </div>

      {/* Progress Modal */}
      {showModal && (
        <ProgressModal
          milestone={modalMilestone}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}