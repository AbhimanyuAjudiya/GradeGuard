import GradeGuardApp from "@/components/GradeGuardApp";
import { CASES } from "@/lib/evaluation/cases";

export default function Home() {
  const cases = CASES.map(({ id, description, category, expectedDecision }) => ({ id, description, category, expectedDecision }));
  return <GradeGuardApp cases={cases} />;
}
