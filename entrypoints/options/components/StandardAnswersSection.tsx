import type { ProfileData } from '@/lib/types';
import { Section, TextInput, TextArea, Button, RepeatableCard } from './primitives';

type Answer = ProfileData['standardAnswers'][number];

const emptyEntry: Answer = { questionPattern: '', answerText: '' };

export function StandardAnswersSection({
  value,
  onChange,
}: {
  value: ProfileData['standardAnswers'];
  onChange: (v: ProfileData['standardAnswers']) => void;
}) {
  const update = (i: number, entry: Answer) =>
    onChange(value.map((e, idx) => (idx === i ? entry : e)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { ...emptyEntry }]);

  return (
    <Section
      title="Standard & Common Answers"
      badge={`${value.length} answers`}
      description="Predefined answers for recurring questions (e.g. 'Why do you want to work here?', 'What is your notice period?')."
      icon={
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      }
    >
      <div className="space-y-3">
        {value.map((entry, i) => (
          <RepeatableCard
            key={i}
            label={
              entry.questionPattern ? `Q: "${entry.questionPattern}"` : `Standard Answer #${i + 1}`
            }
            onRemove={() => remove(i)}
          >
            <TextInput
              label="Question pattern or keyword"
              placeholder="e.g. why do you want to join our team"
              value={entry.questionPattern}
              onChange={(v) => update(i, { ...entry, questionPattern: v })}
            />
            <TextArea
              label="Your customized standard answer"
              placeholder="Write your preferred response template..."
              value={entry.answerText}
              onChange={(v) => update(i, { ...entry, answerText: v })}
            />
          </RepeatableCard>
        ))}
      </div>
      <div>
        <Button variant="secondary" onClick={add}>
          + Add standard answer
        </Button>
      </div>
    </Section>
  );
}
