package org.ceitba.api.service.staff;

import org.ceitba.api.common.exception.ResourceNotFoundException;
import org.ceitba.api.domain.StaffDepartment;
import org.ceitba.api.domain.StaffMember;
import org.ceitba.api.repository.StaffDepartmentRepository;
import org.ceitba.api.repository.StaffMemberRepository;
import org.ceitba.api.web.staff.dto.CreateStaffMemberRequest;
import org.ceitba.api.web.staff.dto.StaffDepartmentResponse;
import org.ceitba.api.web.staff.dto.StaffMemberResponse;
import org.ceitba.api.web.staff.dto.UpdateStaffDepartmentRequest;
import org.ceitba.api.web.staff.dto.UpdateStaffMemberRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

// Manages the public staff roster (CeitbaPage). The "operational" CEITBA
// staff (ROLE_STAFF) lives in StaffService — that is identity, this is content.
@Service
public class StaffRosterService {

    private final StaffMemberRepository memberRepository;
    private final StaffDepartmentRepository departmentRepository;

    public StaffRosterService(StaffMemberRepository memberRepository,
                              StaffDepartmentRepository departmentRepository) {
        this.memberRepository = memberRepository;
        this.departmentRepository = departmentRepository;
    }

    @Transactional(readOnly = true)
    public List<StaffDepartmentResponse> listDepartments() {
        return departmentRepository.findAllByOrderByDisplayOrderAsc().stream()
            .map(this::toResponse)
            .toList();
    }

    @Transactional
    public StaffDepartmentResponse updateDepartment(String slug, UpdateStaffDepartmentRequest req) {
        var d = departmentRepository.findById(slug)
            .orElseThrow(() -> new ResourceNotFoundException("StaffDepartment", slug));
        d.setColorVar(req.colorVar());
        d.setDisplayOrder(req.displayOrder());
        return toResponse(departmentRepository.save(d));
    }

    @Transactional(readOnly = true)
    public List<Integer> listYears() {
        return memberRepository.findDistinctYearsDesc();
    }

    @Transactional(readOnly = true)
    public List<StaffMemberResponse> listMembers(int year) {
        return memberRepository
            .findAllByYearOrderByDepartmentSlugAscDisplayOrderAscNameAsc(year).stream()
            .map(this::toResponse)
            .toList();
    }

    @Transactional
    public StaffMemberResponse createMember(CreateStaffMemberRequest req) {
        requireDepartment(req.departmentSlug());
        var m = new StaffMember(req.year(), req.departmentSlug(), req.name(), req.roleEs(), req.roleEn());
        m.setDisplayOrder(req.displayOrder());
        m.setPhotoUrl(req.photoUrl());
        m.setLinkedinUrl(req.linkedinUrl());
        m.setEmail(req.email());
        return toResponse(memberRepository.save(m));
    }

    @Transactional
    public StaffMemberResponse updateMember(UUID id, UpdateStaffMemberRequest req) {
        var m = memberRepository.findById(id)
            .orElseThrow(() -> new ResourceNotFoundException("StaffMember", id.toString()));
        requireDepartment(req.departmentSlug());
        m.setYear(req.year());
        m.setDepartmentSlug(req.departmentSlug());
        m.setDisplayOrder(req.displayOrder());
        m.setName(req.name());
        m.setRoleEs(req.roleEs());
        m.setRoleEn(req.roleEn());
        m.setPhotoUrl(req.photoUrl());
        m.setLinkedinUrl(req.linkedinUrl());
        m.setEmail(req.email());
        return toResponse(memberRepository.save(m));
    }

    @Transactional
    public void deleteMember(UUID id) {
        if (!memberRepository.existsById(id)) {
            throw new ResourceNotFoundException("StaffMember", id.toString());
        }
        memberRepository.deleteById(id);
    }

    private void requireDepartment(String slug) {
        if (!departmentRepository.existsById(slug)) {
            throw new ResourceNotFoundException("StaffDepartment", slug);
        }
    }

    private StaffDepartmentResponse toResponse(StaffDepartment d) {
        return new StaffDepartmentResponse(d.getSlug(), d.getColorVar(), d.getDisplayOrder());
    }

    private StaffMemberResponse toResponse(StaffMember m) {
        return new StaffMemberResponse(
            m.getId(), m.getYear(), m.getDepartmentSlug(), m.getDisplayOrder(),
            m.getName(), m.getRoleEs(), m.getRoleEn(),
            m.getPhotoUrl(), m.getLinkedinUrl(), m.getEmail()
        );
    }
}
