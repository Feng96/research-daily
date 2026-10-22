# Matched-input progressive line refinement comparison

We implement a NAIP adaptation of Jung & Sohn (2019), DOI
10.1016/j.isprsjprs.2019.01.003. This is an executable core-idea comparison,
not an exact reproduction of original datasets, detectors, camera projection,
proposal probabilities or published scores. It replaces the previous
workflow-order-only control with actual image-driven geometry optimization.

Both methods receive identical original NAIP RGB + 3DEP XYZ/source IDs,
registered footprints, ground and native settings. Two matched input blocks:
1. Raw candidate returns, no semantic prefilter shared by both methods.
2. The previous frozen guarded mask, shared by both methods.

In each block, build one common initial Roofer model. Give that exact model to
both backends. Our arm uses the frozen point MLP plus original observed-plane
support and the existing local reassignment rules; the paper arm uses image
lines/corners and fixed initial planes. The plane count stays fixed in the
paper arm while boundaries may move. This compares backends, not independently
optimized end-to-end systems. All raw XYZ stay immutable. Neither arm reads
US roof GT (none is available).

Adapted modules: Canny + probabilistic Hough lines and Harris corners replace
Kovesi/Chabat; raster georeferencing replaces perspective camera equations;
8 compass directions and nearby image/model/corner associations generate
line replacement, compass connector and corner-arm connector proposals.
The objective balances a boundary-observation and plane-homogeneity fit with
vertex/direction/angle complexity. An annealed Metropolis search explores
hypotheses; it does not claim exact original MCMC transition probabilities,
stationary sampling or a proven global optimum. Fixed planes lift accepted
XY contours into 3D and create step walls. A shared edge diagnostic retains
separate candidates and checked outputs, including rejection/failure cases.

Settings are fixed before observing comparison outcomes. Use three fixed seeds
per real building/block. Select by the declared objective, never by reference
accuracy. Report seed spread, edit types, image cue counts, elapsed time,
footprint change, observed-point agreement and quality checks. These diagnostics
are not independent accuracy. Synthetic images/points are a separate bounded
mechanism check with known geometry; they do not establish US accuracy.

Large artifacts and the staged website are under
/lustre/isaac24/scratch/yfeng21/lod2_paper_compare_20261022.
Code and small configuration remain in HOME. The existing GitHub Pages and
its single five-step home remain the publication destination.
