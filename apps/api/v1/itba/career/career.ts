import express from "express";
import supabase from "../../config/supabase";
import { Career } from "../ceitbapi/modules";
const router = express.Router();
interface PlanSupabase {
    id: string;
    career: {
        name: string;
        id: string;
    };
}

/**
 * @openapi
 * /itba/career/plans:
 *   get:
 *     tags:
 *       - ITBA
 *     summary: Retrieve career plans
 *     description: >
 *       Retrieves a list of career plans grouped by career ID and name.
 *     responses:
 *       200:
 *         description: A map of career IDs to career details, including plans.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   name:
 *                     type: string
 *                   plans:
 *                     type: array
 *                     items:
 *                       type: string
 *       500:
 *         description: Internal server error
 */
router.get("/plans", async (req, res) => {
    try {
        const plans = await getPlansByCareer();
        res.json(plans);
    } catch (error) {
        res.status(500).json({ error: "Error fetching plans" });
    }
})

async function getPlansByCareer(): Promise<Record<string, Career>> {
    const { data, error } = await supabase
        .from("plan")
        .select(`id, career (id,name)`);

    if (error) {
        throw new Error(`Error fetching plans: ${error.message}`);
    }

    const careers = new Map<string, Career>();

    for (const plan of data as unknown as PlanSupabase[]) {
        if (!careers.has(plan.career.id)) {
            careers.set(plan.career.id, {
                id: plan.career.id,
                name: plan.career.name,
                plans: [],
            });
        }
        careers.get(plan.career.id)!.plans.push(plan.id);      

    }

    console.log(careers);
    // Convert Map to an object for easier usage
    return Object.fromEntries(careers);
}

getPlansByCareer()
export default router;