import { Subject } from "@/domain/itba/models/subject.model";
import { SubjectRepository } from "@/domain/itba/interfaces/repositories/subject.repository.interface";
import {
  SubjectNotFoundException,
  SubjectAlreadyExistsException,
  ForeignKeyConstraintViolationException,
} from "@/domain/itba/exceptions/itba.exceptions";
import { GenericDomainException } from "@/shared/exceptions";
import { PrismaService } from "@/shared/database/prisma.service";

export class SubjectRepositoryImpl implements SubjectRepository {
  private readonly prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.prisma = prisma;
  }

  async findAll(): Promise<Subject[]> {
    const result = await this.prisma.subject.findMany({
      select: { id: true, name: true, credits: true },
      orderBy: { id: "asc" },
    });

    return result.map(
      (subject) => new Subject(subject.id, subject.name, subject.credits),
    );
  }

  async findById(id: string): Promise<Subject | null> {
    const result = await this.prisma.subject.findUnique({
      where: { id },
      select: { id: true, name: true, credits: true },
    });

    if (!result) {
      return null;
    }

    return new Subject(result.id, result.name, result.credits);
  }

  async findByName(name: string): Promise<Subject[]> {
    const result = await this.prisma.subject.findMany({
      where: {
        name: {
          contains: name,
          mode: "insensitive",
        },
      },
      select: { id: true, name: true, credits: true },
      orderBy: { name: "asc" },
    });

    return result.map(
      (subject) => new Subject(subject.id, subject.name, subject.credits),
    );
  }

  async create(subject: Subject): Promise<Subject> {
    const result = await this.prisma.subject
      .create({
        data: {
          id: subject.id,
          name: subject.name,
          credits: subject.credits,
        },
        select: { id: true, name: true, credits: true },
      })
      .catch((err) => {
        switch (err.code) {
          case "P2002":
            throw new SubjectAlreadyExistsException(subject.id, err);
          default:
            throw new GenericDomainException(`Failed to create subject`, err);
        }
      });

    return new Subject(result.id, result.name, result.credits);
  }

  async update(subject: Subject): Promise<Subject> {
    const result = await this.prisma.subject
      .update({
        where: { id: subject.id },
        data: {
          name: subject.name,
          credits: subject.credits,
        },
        select: { id: true, name: true, credits: true },
      })
      .catch((err) => {
        switch (err.code) {
          case "P2025":
            throw new SubjectNotFoundException(
              `Subject ${subject.id} not found`,
              err,
            );
          case "P2002":
            throw new SubjectAlreadyExistsException(subject.id, err);
          default:
            throw new GenericDomainException("Failed to update subject", err);
        }
      });

    return new Subject(result.id, result.name, result.credits);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.subject
      .delete({
        where: { id },
      })
      .catch((err) => {
        switch (err.code) {
          case "P2025":
            throw new SubjectNotFoundException(`Subject ${id} not found`, err);
          case "P2003":
            throw new ForeignKeyConstraintViolationException(
              `Cannot delete subject ${id}: it has related records (e.g., plans).`,
              err,
            );
          default:
            throw new GenericDomainException("Failed to delete subject", err);
        }
      });
  }

  async findByIds(ids: string[]): Promise<Subject[]> {
    if (ids.length === 0) {
      return [];
    }

    const result = await this.prisma.subject.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      select: { id: true, name: true, credits: true },
      orderBy: { id: "asc" },
    });

    return result.map(
      (subject) => new Subject(subject.id, subject.name, subject.credits),
    );
  }
}
