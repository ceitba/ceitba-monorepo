import { Branch, Role, StaffType, User } from "./modules"
import express from "express"
import { Request, Response } from "express"
import { getUserByEmail, updateUserRole, createUser, getAllUsers } from "./user";
import { getStaffMembers } from "./staff";

const router = express.Router();

// Helper function to validate enum values
function isValidBranch(value: string): boolean {
  return Object.values(Branch).includes(value as Branch);
}

function isValidStaffType(value: string): boolean {
  return Object.values(StaffType).includes(value as StaffType);
}

/**
 * @openapi
 * components:
 *   schemas:
 *     Branch:
 *       type: string
 *       enum: [IT, MEDIA, INFRA, DEPORTES, NAUTICA, EVENTOS]
 *       description: Department or branch within the organization
 *     StaffType:
 *       type: string
 *       enum: [PRESIDENTE, VICEPRESIDENTE, SECRETARIA, TESORERIA, LIDER, MIEMBRO]
 *       description: Role type within a branch
 *     Organization:
 *       type: object
 *       properties:
 *         organization_name:
 *           type: string
 *           description: Name of the organization
 *         role:
 *           type: string
 *           description: User's role in the organization
 *     Role:
 *       type: object
 *       required:
 *         - branch
 *         - role
 *         - start
 *       properties:
 *         branch:
 *           $ref: '#/components/schemas/Branch'
 *         role:
 *           $ref: '#/components/schemas/StaffType'
 *         start:
 *           type: string
 *           format: date-time
 *           description: Start date of the role
 *         end:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: End date of the role (optional)
 *     User:
 *       type: object
 *       required:
 *         - id
 *         - email
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           description: Unique identifier for the user
 *         email:
 *           type: string
 *           format: email
 *           description: Email address of the user
 *         file_number:
 *           type: integer
 *           nullable: true
 *           description: User's file number
 *         name:
 *           type: string
 *           nullable: true
 *           description: User's full name
 *         career_id:
 *           type: string
 *           nullable: true
 *           description: User's career
 *         plan:
 *           type: string
 *           nullable: true
 *           description: User's plan or program
 *         role:
 *           $ref: '#/components/schemas/Role'
 *           nullable: true
 *         organizations:
 *           type: array
 *           nullable: true
 *           items:
 *             $ref: '#/components/schemas/Organization'
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 */

/**
 * @openapi
 * tags:
 *   - name: User
 *     description: User management operations
 */

/**
 * @openapi
 * /user:
 *   get:
 *     tags:
 *       - User
 *     summary: Get user by email
 *     description: Retrieves a user's information by their email address
 *     parameters:
 *       - name: email
 *         in: query
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: Email of the user to retrieve
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Missing required parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/", async (req: Request, res: Response) => {
    const email: string = req.query.email as string;

    if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
    }

    const user = await getUserByEmail(email);

    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }

    res.status(200).json(user);
});

/**
 * @openapi
 * /user/role:
 *   put:
 *     tags:
 *       - User
 *     summary: Update user role
 *     description: Updates the role information for a user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - branch
 *               - role
 *               - start
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email of the user to update
 *               branch:
 *                 $ref: '#/components/schemas/Branch'
 *               role:
 *                 $ref: '#/components/schemas/StaffType'
 *               start:
 *                 type: string
 *                 format: date
 *                 description: Start date of the role
 *               end:
 *                 type: string
 *                 format: date
 *                 description: End date of the role (optional)
 *     responses:
 *       200:
 *         description: User role updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         description: Bad request - invalid parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put("/role", async (req: Request, res: Response) => {
    const email: string = req.body.email;

    if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
    }

    if (!req.body.branch || !req.body.role || !req.body.start) {
        res.status(400).json({ error: "Branch, role and start date are required" });
        return;
    }

    // Validate branch and role values
    if (!isValidBranch(req.body.branch)) {
        res.status(400).json({ 
            error: `Invalid branch value: ${req.body.branch}. Valid values are: ${Object.values(Branch).join(', ')}` 
        });
        return;
    }

    if (!isValidStaffType(req.body.role)) {
        res.status(400).json({ 
            error: `Invalid role value: ${req.body.role}. Valid values are: ${Object.values(StaffType).join(', ')}` 
        });
        return;
    }

    const startDate = new Date(req.body.start);
    const endDate = req.body.end ? new Date(req.body.end) : null;

    const role: Role = {
        branch: req.body.branch as Branch,
        role: req.body.role as StaffType,
        start: startDate,
        end: endDate
    }

    const result = await updateUserRole(email, role);

    if (!result.success) {
        res.status(400).json({ error: result.message });
        return;
    }

    res.status(200).json({ message: "User role updated" });
});

/**
 * @openapi
 * /user:
 *   post:
 *     tags:
 *       - User
 *     summary: Create a new user
 *     description: Creates a new user record in the database
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email of the user
 *               file_number:
 *                 type: integer
 *                 description: User's file number
 *               name:
 *                 type: string
 *                 description: User's name
 *               career_id:
 *                 type: string
 *                 description: User's career id
 *               plan:
 *                 type: string
 *                 description: User's plan
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       400:
 *         description: Bad request - invalid parameters or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/", async (req: Request, res: Response) => {
    const email: string = req.body.email;

    if (!email) {
        res.status(400).json({ error: "Email is required" });
        return;
    }

    try {
        const result = await createUser(email, {
            file_number: req.body.file_number,
            name: req.body.name,
            career_id: req.body.career_id,
            plan: req.body.plan
        });
        
        if ('error' in result) {
            res.status(400).json({ error: result.error });
            return;
        }
        
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
});

/**
 * @openapi
 * /user/staff:
 *   get:
 *     tags:
 *       - User
 *     summary: Get all staff members
 *     description: Retrieves all staff members from the database
 *     responses:
 *       200:
 *         description: Staff members retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/StaffMember'
 */
router.get("/staff", async (req: Request, res: Response) => {
    const {staff, error} = await getStaffMembers();
    if (error) {
        res.status(400).json({ error: error });
        return;
    }
    res.status(200).json(staff);
});

/**
 * @openapi
 * /user/all:
 *   get:
 *     tags:
 *       - User
 *     summary: Get all users
 *     description: Retrieves all users from the database
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/User'
 */
router.get("/all", async (req: Request, res: Response) => {
    const {users, error} = await getAllUsers();
    if (error) {
        res.status(400).json({ error: error });
        return;
    }
    res.status(200).json(users);
});

export default router;