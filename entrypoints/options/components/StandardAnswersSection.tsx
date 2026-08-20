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
      title="Standard answers"
      description="Reusable answers keyed by the kind of question they match."
    >
      {value.map((entry, i) => (
        <RepeatableCard key={i} label={`Answer ${i + 1}`} onRemove={() => remove(i)}>
          <TextInput
            label="Question pattern"
            placeholder="why do you want to work here"
            value={entry.questionPattern}
            onChange={(v) => update(i, { ...entry, questionPattern: v })}
          />
          <TextArea
            label="Answer text"
            value={entry.answerText}
            onChange={(v) => update(i, { ...entry, answerText: v })}
          />
        </RepeatableCard>
      ))}
      <Button onClick={add}>Add standard answer</Button>
    </Section>
  );
}
