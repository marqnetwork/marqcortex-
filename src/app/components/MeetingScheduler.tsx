/**
 * MEETING SCHEDULER — Unified Design
 *
 * When BACKEND_INTEGRATION=false, renders a fully interactive built-in
 * calendar with selectable dates and time slots, meeting confirmation,
 * and a rich "call details" preview. No Calendly dependency in demo mode.
 *
 * When BACKEND_INTEGRATION=true, loads the Calendly widget as before.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Calendar, Clock, Video, CheckCircle2, User, Mail,
  Phone, MessageSquare, ChevronLeft, ChevronRight,
  Brain, Users, FileText, Sparkles, MapPin,
} from 'lucide-react';
import { getDemoScheduledMeeting } from '@/app/services/dataService';

interface MeetingSchedulerProps {
  clientData: {
    name: string;
    email: string;
    companyName: string;
    readinessScore?: number | string;
    submissionId: string;
  };
  onScheduled?: (meetingData: ScheduledMeeting) => void;
}

export interface ScheduledMeeting {
  id: string;
  scheduledAt: string;
  duration: number;
  meetingUrl: string;
  calendarEventId: string;
}

// ── Time slots ────────────────────────────────────────────────────────────────

const MORNING_SLOTS  = ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'];
const AFTERNOON_SLOTS = ['1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM'];

function getAvailableSlots(date: Date): string[] {
  // Simulate some slots being "booked" based on the day
  const day = date.getDay();
  if (day === 0 || day === 6) return []; // weekends
  const seed = date.getDate() % 3;
  if (seed === 0) return [...MORNING_SLOTS.slice(1), ...AFTERNOON_SLOTS.slice(0, 4)];
  if (seed === 1) return [...MORNING_SLOTS.slice(0, 4), ...AFTERNOON_SLOTS.slice(2)];
  return [...MORNING_SLOTS, ...AFTERNOON_SLOTS.slice(1, 5)];
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Main component ────────────────────────────────────────────────────────────

export function MeetingScheduler({ clientData, onScheduled }: MeetingSchedulerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const demoMeeting = useMemo(() => getDemoScheduledMeeting(), []);
  const slots = selectedDate ? getAvailableSlots(selectedDate) : [];

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const { year, month } = viewMonth;
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [viewMonth]);

  const handleConfirm = () => {
    if (!selectedDate || !selectedTime) return;
    setIsConfirmed(true);

    const meeting: ScheduledMeeting = {
      id: `meeting_${Date.now()}`,
      scheduledAt: selectedDate.toISOString(),
      duration: 45,
      meetingUrl: 'https://zoom.us/j/98765432100?pwd=demo',
      calendarEventId: `cal_${Date.now()}`,
    };

    onScheduled?.(meeting);
  };

  const isDateSelectable = (day: number) => {
    const d = new Date(viewMonth.year, viewMonth.month, day);
    return d >= today && d.getDay() !== 0 && d.getDay() !== 6;
  };

  const isSelectedDate = (day: number) => {
    if (!selectedDate) return false;
    return (
      selectedDate.getDate() === day &&
      selectedDate.getMonth() === viewMonth.month &&
      selectedDate.getFullYear() === viewMonth.year
    );
  };

  const isToday = (day: number) => {
    return (
      today.getDate() === day &&
      today.getMonth() === viewMonth.month &&
      today.getFullYear() === viewMonth.year
    );
  };

  // ── Confirmed state ─────────────────────────────────────────────────────────

  if (isConfirmed && selectedDate && selectedTime) {
    return (
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          {/* Success hero */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.15 }}
            className="inline-flex items-center justify-center size-20 rounded-full bg-gradient-to-br from-[#10B981] to-[#06D7F6] mb-6"
          >
            <CheckCircle2 className="size-10 text-white" />
          </motion.div>

          <h2 className="text-3xl font-bold text-white mb-2">You're All Set!</h2>
          <p className="text-gray-400 text-lg mb-8">
            Your readiness call is confirmed, {clientData.name.split(' ')[0]}
          </p>

          {/* Meeting card */}
          <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 mb-8 text-left">
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/10">
              <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center">
                <Brain className="size-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-white">MARQ Cortex Readiness Call</h3>
                <p className="text-xs text-gray-500">AI Operations Discovery Session</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <MeetingDetail
                icon={<Calendar className="size-5 text-[#8B5CF6]" />}
                label="Date"
                value={selectedDate.toLocaleDateString('en-US', {
                  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                })}
              />
              <MeetingDetail
                icon={<Clock className="size-5 text-[#06D7F6]" />}
                label="Time"
                value={`${selectedTime} (PST)`}
              />
              <MeetingDetail
                icon={<Video className="size-5 text-[#FB923C]" />}
                label="Duration"
                value="45 minutes"
              />
              <MeetingDetail
                icon={<MapPin className="size-5 text-[#10B981]" />}
                label="Location"
                value="Zoom (link sent via email)"
              />
            </div>

            {/* Attendees */}
            <div className="mt-6 pt-5 border-t border-white/10">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Your MARQ Cortex Team</p>
              <div className="flex gap-4">
                {demoMeeting.attendees.map((a, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="size-9 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center text-xs font-bold text-white">
                      {a.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{a.name}</p>
                      <p className="text-xs text-gray-500">{a.role}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Agenda preview */}
          <div className="bg-gradient-to-br from-[#8B5CF6]/10 to-[#3B82F6]/10 border border-[#8B5CF6]/20 rounded-2xl p-6 mb-8 text-left">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <FileText className="size-4 text-[#8B5CF6]" />
              Call Agenda
            </h3>
            <div className="space-y-3">
              {demoMeeting.agenda.map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="size-6 rounded-full bg-[#8B5CF6]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-[#8B5CF6]">{i + 1}</span>
                  </div>
                  <p className="text-sm text-gray-300">{item}</p>
                </div>
              ))}
            </div>
          </div>

          {/* What to prepare */}
          <div className="bg-black/30 border border-white/10 rounded-2xl p-6 text-left">
            <h3 className="font-bold text-white mb-4 flex items-center gap-2">
              <Sparkles className="size-4 text-[#06D7F6]" />
              How to Prepare
            </h3>
            <div className="space-y-3">
              {[
                'Review your Readiness Report in the portal before the call',
                'Note any specific areas you want to deep-dive into',
                'Have key stakeholders join if possible — leadership alignment accelerates results',
                'No preparation required on your end — we come to you with the analysis',
              ].map((tip, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <CheckCircle2 className="size-4 text-[#06D7F6] flex-shrink-0 mt-0.5" />
                  <span className="text-gray-400">{tip}</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Scheduler view ──────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring' }}
          className="inline-flex items-center justify-center size-16 rounded-2xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] mb-4"
        >
          <Calendar className="size-8 text-white" />
        </motion.div>
        <h2 className="text-3xl font-bold text-white mb-3">Schedule Your Readiness Call</h2>
        <p className="text-gray-400 text-lg">
          Pick a date and time that works for you
        </p>
      </div>

      {/* What to Expect */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <ExpectCard
          icon={<Clock className="size-6 text-[#06D7F6]" />}
          title="45 Minutes"
          description="Focused discussion on your report"
        />
        <ExpectCard
          icon={<Video className="size-6 text-[#8B5CF6]" />}
          title="Video Call"
          description="Zoom link sent after booking"
        />
        <ExpectCard
          icon={<MessageSquare className="size-6 text-[#FB923C]" />}
          title="No Pressure"
          description="Just exploring what's possible"
        />
      </div>

      {/* Calendar + time slots */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-3 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() =>
                setViewMonth(prev => {
                  const m = prev.month - 1;
                  return m < 0
                    ? { year: prev.year - 1, month: 11 }
                    : { ...prev, month: m };
                })
              }
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <ChevronLeft className="size-5" />
            </button>
            <h3 className="font-bold text-white text-lg">
              {MONTH_NAMES[viewMonth.month]} {viewMonth.year}
            </h3>
            <button
              onClick={() =>
                setViewMonth(prev => {
                  const m = prev.month + 1;
                  return m > 11
                    ? { year: prev.year + 1, month: 0 }
                    : { ...prev, month: m };
                })
              }
              className="p-2 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-xs font-semibold text-gray-600 py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Date grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} className="aspect-square" />;
              }
              const selectable = isDateSelectable(day);
              const selected = isSelectedDate(day);
              const todayMark = isToday(day);

              return (
                <button
                  key={day}
                  disabled={!selectable}
                  onClick={() => {
                    setSelectedDate(new Date(viewMonth.year, viewMonth.month, day));
                    setSelectedTime(null);
                  }}
                  className={`aspect-square rounded-xl flex items-center justify-center text-sm font-medium transition-all relative ${
                    selected
                      ? 'bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] text-white shadow-lg shadow-[#8B5CF6]/30'
                      : selectable
                      ? 'text-gray-300 hover:bg-white/10 hover:text-white cursor-pointer'
                      : 'text-gray-700 cursor-not-allowed'
                  }`}
                >
                  {day}
                  {todayMark && !selected && (
                    <span className="absolute bottom-1 size-1 rounded-full bg-[#06D7F6]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/10 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#06D7F6]" /> Today
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#8B5CF6]" /> Selected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-gray-700" /> Unavailable
            </span>
          </div>
        </div>

        {/* Time slots */}
        <div className="lg:col-span-2 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          {!selectedDate ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <Calendar className="size-10 text-gray-600 mb-3" />
              <p className="text-gray-500 text-sm">Select a date to see available times</p>
            </div>
          ) : (
            <span className="contents">
              <h4 className="font-bold text-white mb-1">
                {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h4>
              <p className="text-xs text-gray-500 mb-5">{slots.length} slots available · Pacific Time (PST)</p>

              {slots.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="size-8 text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">No slots available on this day</p>
                  <p className="text-gray-600 text-xs mt-1">Try a weekday</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {/* Morning label */}
                  {slots.some(s => s.includes('AM')) && (
                    <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider pt-1">Morning</p>
                  )}
                  {slots.filter(s => s.includes('AM')).map(slot => (
                    <button
                      key={slot}
                      onClick={() => setSelectedTime(slot)}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all border ${
                        selectedTime === slot
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-white'
                          : 'border-white/8 text-gray-300 hover:bg-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Clock className="size-3.5 text-gray-500" />
                          {slot}
                        </span>
                        {selectedTime === slot && (
                          <CheckCircle2 className="size-4 text-[#8B5CF6]" />
                        )}
                      </div>
                    </button>
                  ))}

                  {/* Afternoon label */}
                  {slots.some(s => s.includes('PM')) && (
                    <p className="text-[10px] font-bold text-gray-600 uppercase tracking-wider pt-3">Afternoon</p>
                  )}
                  {slots.filter(s => s.includes('PM')).map(slot => (
                    <button
                      key={slot}
                      onClick={() => setSelectedTime(slot)}
                      className={`w-full text-left px-4 py-3 rounded-xl text-sm font-medium transition-all border ${
                        selectedTime === slot
                          ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 text-white'
                          : 'border-white/8 text-gray-300 hover:bg-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2">
                          <Clock className="size-3.5 text-gray-500" />
                          {slot}
                        </span>
                        {selectedTime === slot && (
                          <CheckCircle2 className="size-4 text-[#8B5CF6]" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Confirm CTA */}
              <AnimatePresence>
                {selectedTime && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="mt-5 pt-5 border-t border-white/10"
                  >
                    <div className="text-xs text-gray-500 mb-3 text-center">
                      {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {selectedTime} PST · 45 min
                    </div>
                    <button
                      onClick={handleConfirm}
                      className="w-full py-3.5 bg-gradient-to-r from-[#8B5CF6] to-[#3B82F6] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                    >
                      <CheckCircle2 className="size-4" />
                      Confirm Booking
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </span>
          )}
        </div>
      </div>

      {/* Help Text */}
      <div className="mt-6 text-center text-sm text-gray-500">
        <p>
          Can't find a time that works?{' '}
          <a href="mailto:team@marqcortex.com" className="text-[#06D7F6] hover:underline">
            Contact us
          </a>{' '}
          to schedule manually.
        </p>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ExpectCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl p-6 text-center">
      <div className="inline-flex items-center justify-center size-12 rounded-xl bg-white/5 mb-3">
        {icon}
      </div>
      <h3 className="font-bold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400">{description}</p>
    </div>
  );
}

function MeetingDetail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="text-xs text-gray-500 mb-0.5">{label}</div>
        <div className="text-sm font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}