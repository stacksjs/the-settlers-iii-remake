const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const craft = b.dependency("craft", .{ .target = target, .optimize = optimize, .@"desktop-host" = false });
    const app = b.addExecutable(.{ .name = "settlers-retained-probe", .root_module = b.createModule(.{
        .root_source_file = b.path("main.zig"),
        .target = target,
        .optimize = optimize,
        .link_libc = true,
        .imports = &.{.{ .name = "craft", .module = craft.module("craft") }},
    }) });
    b.installArtifact(app);
}
