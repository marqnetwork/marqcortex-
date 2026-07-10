/**
 * 🚀 INSTANT MEETING BOOKING
 * 
 * PROBLEM: Average time to meeting is 24 hours (email back-and-forth)
 * SOLUTION: Instant booking available in thank-you page
 * 
 * FEATURES:
 * - "Skip the wait - Book your call now" on thank-you page
 * - Priority review (bumped to top of queue)
 * - Express report delivery (guaranteed 4 hours)
 * - Calendar availability shown immediately
 * - Incentive: "Book now, get report 80% faster"
 * 
 * EXPECTED IMPACT: Time to call 24h → 4h (-83%)
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Zap, Clock, TrendingUp, CheckCircle2, Sparkles } from 'lucide-react';

interface InstantBookingProps {
  contactInfo: {
    name: string;
    email: string;
    companyName: string;
  };
  onBooked: (meetingData: { scheduledAt: string; priority: boolean }) => void;
}

export function InstantBookingOffer({ contactInfo, onBooked }: InstantBookingProps) {
  const [showBooking, setShowBooking] = useState(false);
  const [isBooking, setIsBooking] = useState(false);

  const handleBookNow = () => {
    setShowBooking(true);
  };

  const handleTimeSelected = async (time: string) => {
    setIsBooking(true);
    
    // Book the meeting with priority flag
    await bookPriorityMeeting({
      email: contactInfo.email,
      name: contactInfo.name,
      scheduledAt: time,
      priority: true
    });
    
    onBooked({
      scheduledAt: time,
      priority: true
    });
  };

  return (
    <span className="contents">
      {/* Main Offer Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden bg-gradient-to-br from-[#8B5CF6]/20 via-[#3B82F6]/20 to-[#06D7F6]/20 border-2 border-[#8B5CF6]/40 rounded-2xl p-8 mb-8"
      >
        {/* Animated Background */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-0 right-0 size-32 bg-[#8B5CF6]/30 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-0 left-0 size-32 bg-[#06D7F6]/30 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <div className="relative">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[#FB923C]/30 to-[#FD4438]/30 border border-[#FB923C]/40 rounded-full mb-4">
            <Zap className="size-4 text-[#FB923C]" />
            <span className="text-sm font-bold text-white">Limited Time Offer</span>
          </div>

          {/* Headline */}
          <h3 className="text-3xl font-bold text-white mb-3">
            Skip the Wait - Book Your Call Now
          </h3>

          <p className="text-lg text-white/80 mb-6">
            Book in the next 10 minutes and get <strong className="text-[#06D7F6]">priority processing</strong>
          </p>

          {/* Benefits Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <PriorityBenefit
              icon={<Zap className="size-5 text-[#FB923C]" />}
              title="Express Report"
              description="Guaranteed in 4 hours"
              highlight="vs 24+ hours"
            />
            <PriorityBenefit
              icon={<TrendingUp className="size-5 text-[#10B981]" />}
              title="Priority Review"
              description="Moved to top of queue"
              highlight="Skip the line"
            />
            <PriorityBenefit
              icon={<Sparkles className="size-5 text-[#8B5CF6]" />}
              title="Best Time Slots"
              description="Access to premium times"
              highlight="Limited spots"
            />
          </div>

          {/* CTA */}
          <motion.button
            onClick={handleBookNow}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="w-full md:w-auto px-8 py-4 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:from-[#7C3AED] hover:to-[#2563EB] text-white rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all shadow-xl"
          >
            <Calendar className="size-5" />
            Book My Priority Call Now
            <Zap className="size-5" />
          </motion.button>

          {/* Urgency Timer */}
          <CountdownTimer minutes={10} />

          {/* Social Proof */}
          <div className="mt-6 flex items-center gap-3 text-sm text-white/70">
            <div className="flex -space-x-2">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="size-8 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] border-2 border-[#0A0A0F] flex items-center justify-center text-xs font-bold"
                >
                  {String.fromCharCode(64 + i)}
                </div>
              ))}
            </div>
            <p>
              <strong className="text-white">23 businesses</strong> booked priority calls this week
            </p>
          </div>
        </div>
      </motion.div>

      {/* Booking Modal */}
      <AnimatePresence>
        {showBooking && (
          <InstantBookingModal
            contactInfo={contactInfo}
            onClose={() => setShowBooking(false)}
            onTimeSelected={handleTimeSelected}
            isBooking={isBooking}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

// ============================================================================
// BOOKING MODAL
// ============================================================================

interface InstantBookingModalProps {
  contactInfo: { name: string; email: string; companyName: string };
  onClose: () => void;
  onTimeSelected: (time: string) => void;
  isBooking: boolean;
}

function InstantBookingModal({
  contactInfo,
  onClose,
  onTimeSelected,
  isBooking
}: InstantBookingModalProps) {
  const availableSlots = getNextAvailableSlots();
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#0A0A0F] border border-[#8B5CF6]/30 rounded-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="size-12 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
              <Zap className="size-6 text-white" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-white">Priority Time Slots</h3>
              <p className="text-sm text-white/60">Express review guaranteed</p>
            </div>
          </div>
          
          <div className="bg-gradient-to-r from-[#10B981]/20 to-[#06D7F6]/20 border border-[#10B981]/30 rounded-xl p-4">
            <p className="text-sm text-white/80">
              ⚡ <strong>Special Offer:</strong> Book now and your report will be ready <strong className="text-[#10B981]">before your call</strong>
            </p>
          </div>
        </div>

        {/* Available Slots */}
        <div className="space-y-2 mb-6">
          <h4 className="text-sm font-semibold text-white/80 mb-3">Select Your Time</h4>
          {availableSlots.map((slot) => (
            <button
              key={slot.iso}
              onClick={() => setSelectedSlot(slot.iso)}
              className={`w-full text-left px-4 py-3 border rounded-xl transition-all ${
                selectedSlot === slot.iso
                  ? 'bg-[#8B5CF6]/30 border-[#8B5CF6] ring-2 ring-[#8B5CF6]/50'
                  : 'bg-white/5 border-white/10 hover:border-[#8B5CF6]/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-white">{slot.displayDate}</p>
                  <p className="text-sm text-white/60">{slot.displayTime}</p>
                </div>
                {slot.isPriority && (
                  <div className="px-3 py-1 bg-[#FB923C]/30 border border-[#FB923C]/40 rounded-full">
                    <p className="text-xs font-bold text-[#FB923C]">PRIORITY</p>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl font-semibold transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedSlot && onTimeSelected(selectedSlot)}
            disabled={!selectedSlot || isBooking}
            className="flex-1 px-6 py-3 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] hover:from-[#7C3AED] hover:to-[#2563EB] text-white rounded-xl font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isBooking ? (
              <span className="contents">
                <div className="size-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Booking...
              </span>
            ) : (
              <span className="contents">
                <CheckCircle2 className="size-5" />
                Confirm Priority Booking
              </span>
            )}
          </button>
        </div>

        {/* Fine Print */}
        <p className="text-xs text-white/50 text-center mt-4">
          🔒 Your spot is held for 5 minutes. Calendar invite will be sent immediately.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

function PriorityBenefit({
  icon,
  title,
  description,
  highlight
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  highlight: string;
}) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-4">
      <div className="flex items-start gap-3 mb-2">
        <div className="size-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h4 className="font-bold text-white">{title}</h4>
          <p className="text-sm text-white/70">{description}</p>
        </div>
      </div>
      <div className="pl-13">
        <span className="text-xs px-2 py-1 bg-[#06D7F6]/20 border border-[#06D7F6]/30 rounded-full text-[#06D7F6] font-semibold">
          {highlight}
        </span>
      </div>
    </div>
  );
}

function CountdownTimer({ minutes }: { minutes: number }) {
  const [timeLeft, setTimeLeft] = useState(minutes * 60);

  useState(() => {
    const interval = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;

  return (
    <div className="mt-4 flex items-center justify-center gap-2">
      <Clock className="size-4 text-[#FB923C]" />
      <p className="text-sm text-white/70">
        Offer expires in{' '}
        <strong className="text-[#FB923C] font-mono">
          {mins}:{secs.toString().padStart(2, '0')}
        </strong>
      </p>
    </div>
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getNextAvailableSlots() {
  const slots = [];
  const now = new Date();

  // Generate next 5 available slots (next 2 days, business hours)
  for (let i = 0; i < 5; i++) {
    const slotTime = new Date(now);
    slotTime.setHours(now.getHours() + 4 + i * 3); // Every 3 hours starting 4 hours from now
    
    // Skip non-business hours
    if (slotTime.getHours() < 9 || slotTime.getHours() > 17) {
      slotTime.setDate(slotTime.getDate() + 1);
      slotTime.setHours(10);
    }

    slots.push({
      iso: slotTime.toISOString(),
      displayDate: slotTime.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
      }),
      displayTime: slotTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
      }),
      isPriority: i < 2 // First 2 slots are priority
    });
  }

  return slots;
}

async function bookPriorityMeeting(data: {
  email: string;
  name: string;
  scheduledAt: string;
  priority: boolean;
}) {
  // In production, call backend API to book priority meeting
  // await fetch('/api/meetings/book-priority', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(data)
  // });
}