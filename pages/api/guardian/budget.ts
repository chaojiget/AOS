import type { NextApiRequest, NextApiResponse } from "next";

import { getGuardianBudgetDto } from "./state";

export default function handler(req: NextApiRequest, res: NextApiResponse): void {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: { message: "Method Not Allowed" } });
    return;
  }

  const budget = getGuardianBudgetDto();
  res.status(200).json(budget);
}
