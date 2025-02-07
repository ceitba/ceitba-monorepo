import express from "express";
import { Request, Response } from "express";
import supabase from "../../config/supabase";
import { Database } from "../models/database.types";

const router = express.Router();

//TODO: Add authentication


const TABLES = ['proposal', 'proposal_comment', 'proposal_rejection', 'proposal_reply', 'proposal_vote'];


/**
 * @openapi
 * tags:
 *   - name: App
 *     description: General application endpoints
 *   - name: Proposals
 *     description: Endpoints related to proposals
 * components:
 *   schemas:
 *     Proposal:
 *       type: object
 *       properties:
 *         author_id:
 *           type: string
 *           nullable: true
 *         authorized:
 *           type: boolean
 *         created_at:
 *           type: string
 *         description:
 *           type: string
 *           nullable: true
 *         files_url:
 *           type: array
 *           items:
 *             type: string
 *           nullable: true
 *         id:
 *           type: string
 *         status:
 *           type: string
 *           enum: ["OPEN", "DENIED", "ACCEPTED"]
 *         title:
 *           type: string
 *         topic:
 *           type: string
 *           nullable: true
 *     ProposalComment:
 *       type: object
 *       properties:
 *         author_id:
 *           type: string
 *         comment:
 *           type: string
 *         created_at:
 *           type: string
 *         id:
 *           type: string
 *         proposal_id:
 *           type: string
 *           nullable: true
 *     ProposalRejection:
 *       type: object
 *       properties:
 *         created_at:
 *           type: string
 *         id:
 *           type: string
 *         mod_id:
 *           type: string
 *         proposal_id:
 *           type: string
 *         rejection_reason:
 *           type: string
 *     ProposalReply:
 *       type: object
 *       properties:
 *         author_id:
 *           type: string
 *         comment_id:
 *           type: string
 *         created_at:
 *           type: string
 *         id:
 *           type: string
 *         reply:
 *           type: string
 *     ProposalVote:
 *       type: object
 *       properties:
 *         is_positive:
 *           type: boolean
 *         proposal_id:
 *           type: string
 *         updated_at:
 *           type: string
 *           format: date-time
 *         user_id:
 *           type: string
 */

/**
 * @openapi
 * /app/proposals/proposal:
 *   get:
 *     tags:
 *       - App
 *     summary: Get all proposals
 *     description: Retrieve all proposals. You can filter the results by providing query parameters.
 *     parameters:
 *       - in: query
 *         name: author_id
 *         schema:
 *           type: string
 *         description: Filter by author ID
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: ["OPEN", "DENIED", "ACCEPTED"]
 *         description: Filter by proposal status
 *     responses:
 *       200:
 *         description: Successfully retrieved all proposals.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Proposal'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */
router.get("/:table", async (req: Request, res: Response) => {
    const { table } = req.params;
    if (!TABLES.includes(table)) {
        res.status(400).json({ error: "Invalid table" });
        return;
    }

    const query = supabase.schema("ceitbapp").from(`${table}`).select("*");

    // Apply filters based on query parameters
    Object.keys(req.query).forEach((key) => {
        query.eq(key, req.query[key]);
    });

    const { data, error } = await query;
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    res.json(data);
});

/**
 * @openapi
 * /app/proposals/proposal_comment:
 *   get:
 *     tags:
 *       - App
 *     summary: Get all proposal comments
 *     description: Retrieve all comments for proposals. You can filter the results by providing query parameters.
 *     parameters:
 *       - in: query
 *         name: author_id
 *         schema:
 *           type: string
 *         description: Filter by author ID
 *       - in: query
 *         name: proposal_id
 *         schema:
 *           type: string
 *         description: Filter by proposal ID
 *     responses:
 *       200:
 *         description: Successfully retrieved all proposal comments.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ProposalComment'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_rejection:
 *   get:
 *     tags:
 *       - App
 *     summary: Get all proposal rejections
 *     description: Retrieve all rejections for proposals. You can filter the results by providing query parameters.
 *     parameters:
 *       - in: query
 *         name: mod_id
 *         schema:
 *           type: string
 *         description: Filter by moderator ID
 *       - in: query
 *         name: proposal_id
 *         schema:
 *           type: string
 *         description: Filter by proposal ID
 *     responses:
 *       200:
 *         description: Successfully retrieved all proposal rejections.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ProposalRejection'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_reply:
 *   get:
 *     tags:
 *       - App
 *     summary: Get all proposal replies
 *     description: Retrieve all replies for proposal comments. You can filter the results by providing query parameters.
 *     parameters:
 *       - in: query
 *         name: author_id
 *         schema:
 *           type: string
 *         description: Filter by author ID
 *       - in: query
 *         name: comment_id
 *         schema:
 *           type: string
 *         description: Filter by comment ID
 *     responses:
 *       200:
 *         description: Successfully retrieved all proposal replies.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ProposalReply'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_vote:
 *   get:
 *     tags:
 *       - App
 *       - Proposals
 *     summary: Get all proposal votes
 *     description: Retrieve all votes for proposals. You can filter the results by providing query parameters.
 *     parameters:
 *       - in: query
 *         name: proposal_id
 *         schema:
 *           type: string
 *         description: Filter by proposal ID
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: string
 *         description: Filter by user ID
 *     responses:
 *       200:
 *         description: Successfully retrieved all proposal votes.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ProposalVote'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal/{id}:
 *   get:
 *     tags:
 *       - App
 *     summary: Get a proposal by ID
 *     description: Retrieve a single proposal by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal to retrieve.
 *     responses:
 *       200:
 *         description: Successfully retrieved the proposal by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */
router.get('/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!TABLES.includes(table)) {
        res.status(400).json({ error: 'Invalid table' });
        return;
    }
    const { data, error } = await supabase.from(`${table}`).select('*').eq('id', id).single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
});

/**
 * @openapi
 * /app/proposals/proposal_comment/{id}:
 *   get:
 *     tags:
 *       - App
 *     summary: Get a proposal comment by ID
 *     description: Retrieve a single proposal comment by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal comment to retrieve.
 *     responses:
 *       200:
 *         description: Successfully retrieved the proposal comment by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalComment'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_rejection/{id}:
 *   get:
 *     tags:
 *       - App
 *     summary: Get a proposal rejection by ID
 *     description: Retrieve a single proposal rejection by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal rejection to retrieve.
 *     responses:
 *       200:
 *         description: Successfully retrieved the proposal rejection by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalRejection'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_reply/{id}:
 *   get:
 *     tags:
 *       - App
 *     summary: Get a proposal reply by ID
 *     description: Retrieve a single proposal reply by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal reply to retrieve.
 *     responses:
 *       200:
 *         description: Successfully retrieved the proposal reply by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalReply'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_vote/{proposal_id}/{user_id}:
 *   get:
 *     tags:
 *       - App
 *       - Proposals
 *     summary: Get a proposal vote by proposal ID and user ID
 *     description: Retrieve a single proposal vote by proposal ID and user ID.
 *     parameters:
 *       - name: proposal_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal to retrieve the vote for.
 *       - name: user_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user to retrieve the vote for.
 *     responses:
 *       200:
 *         description: Successfully retrieved the proposal vote by proposal ID and user ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalVote'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal:
 *   post:
 *     tags:
 *       - App
 *     summary: Insert a new proposal
 *     description: Insert a new proposal.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Proposal'
 *     responses:
 *       200:
 *         description: Successfully inserted the new proposal.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */
router.post('/:table', async (req, res) => {
    const { table } = req.params;
    if (!TABLES.includes(table)) { res.status(400).json({ error: 'Invalid table' }); return; }

    const { data, error } = await supabase.from(`${table}`).insert(req.body);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
});

/**
 * @openapi
 * /app/proposals/proposal_comment:
 *   post:
 *     tags:
 *       - App
 *     summary: Insert a new proposal comment
 *     description: Insert a new proposal comment.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalComment'
 *     responses:
 *       200:
 *         description: Successfully inserted the new proposal comment.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalComment'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_rejection:
 *   post:
 *     tags:
 *       - App
 *     summary: Insert a new proposal rejection
 *     description: Insert a new proposal rejection.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalRejection'
 *     responses:
 *       200:
 *         description: Successfully inserted the new proposal rejection.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalRejection'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_reply:
 *   post:
 *     tags:
 *       - App
 *     summary: Insert a new proposal reply
 *     description: Insert a new proposal reply.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalReply'
 *     responses:
 *       200:
 *         description: Successfully inserted the new proposal reply.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalReply'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_vote:
 *   post:
 *     tags:
 *       - App
 *       - Proposals
 *     summary: Insert a new proposal vote
 *     description: Insert a new proposal vote.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalVote'
 *     responses:
 *       200:
 *         description: Successfully inserted the new proposal vote.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalVote'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal/{id}:
 *   put:
 *     tags:
 *       - App
 *     summary: Update a proposal by ID
 *     description: Update a proposal by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Proposal'
 *     responses:
 *       200:
 *         description: Successfully updated the proposal by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Proposal'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */
router.put('/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!TABLES.includes(table)) { res.status(400).json({ error: 'Invalid table' }); return; }

    const { data, error } = await supabase.from(`${table}`).update(req.body).eq('id', id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
});

/**
 * @openapi
 * /app/proposals/proposal_comment/{id}:
 *   put:
 *     tags:
 *       - App
 *     summary: Update a proposal comment by ID
 *     description: Update a proposal comment by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal comment to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalComment'
 *     responses:
 *       200:
 *         description: Successfully updated the proposal comment by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalComment'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_rejection/{id}:
 *   put:
 *     tags:
 *       - App
 *     summary: Update a proposal rejection by ID
 *     description: Update a proposal rejection by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal rejection to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalRejection'
 *     responses:
 *       200:
 *         description: Successfully updated the proposal rejection by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalRejection'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_reply/{id}:
 *   put:
 *     tags:
 *       - App
 *     summary: Update a proposal reply by ID
 *     description: Update a proposal reply by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal reply to update.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalReply'
 *     responses:
 *       200:
 *         description: Successfully updated the proposal reply by ID.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalReply'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_vote/{proposal_id}/{user_id}:
 *   put:
 *     tags:
 *       - App
 *       - Proposals
 *     summary: Update a proposal vote by proposal ID and user ID
 *     description: Update a proposal vote by proposal ID and user ID.
 *     parameters:
 *       - name: proposal_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal to update the vote for.
 *       - name: user_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user to update the vote for.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ProposalVote'
 *     responses:
 *       200:
 *         description: Successfully updated the proposal vote.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProposalVote'
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal/{id}:
 *   delete:
 *     tags:
 *       - App
 *     summary: Delete a proposal by ID
 *     description: Delete a proposal by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal to delete.
 *     responses:
 *       200:
 *         description: Successfully deleted the proposal by ID.
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */
router.delete('/:table/:id', async (req, res) => {
    const { table, id } = req.params;
    if (!TABLES.includes(table)) { res.status(400).json({ error: 'Invalid table' }); return; }

    const { error } = await supabase.from(`${table}`).delete().eq('id', id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ message: 'Deleted successfully' });
});

/**
 * @openapi
 * /app/proposals/proposal_comment/{id}:
 *   delete:
 *     tags:
 *       - App
 *     summary: Delete a proposal comment by ID
 *     description: Delete a proposal comment by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal comment to delete.
 *     responses:
 *       200:
 *         description: Successfully deleted the proposal comment by ID.
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_rejection/{id}:
 *   delete:
 *     tags:
 *       - App
 *     summary: Delete a proposal rejection by ID
 *     description: Delete a proposal rejection by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal rejection to delete.
 *     responses:
 *       200:
 *         description: Successfully deleted the proposal rejection by ID.
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_reply/{id}:
 *   delete:
 *     tags:
 *       - App
 *     summary: Delete a proposal reply by ID
 *     description: Delete a proposal reply by ID.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal reply to delete.
 *     responses:
 *       200:
 *         description: Successfully deleted the proposal reply by ID.
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

/**
 * @openapi
 * /app/proposals/proposal_vote/{proposal_id}/{user_id}:
 *   delete:
 *     tags:
 *       - App
 *       - Proposals
 *     summary: Delete a proposal vote by proposal ID and user ID
 *     description: Delete a proposal vote by proposal ID and user ID.
 *     parameters:
 *       - name: proposal_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the proposal to delete the vote for.
 *       - name: user_id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user to delete the vote for.
 *     responses:
 *       200:
 *         description: Successfully deleted the proposal vote.
 *       400:
 *         description: Invalid table
 *       500:
 *         description: Internal server error
 */

export default router;